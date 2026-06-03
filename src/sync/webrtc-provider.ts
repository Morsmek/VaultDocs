import * as Y from 'yjs';
import * as awarenessProtocol from 'y-protocols/awareness.js';
import { encryptUpdate, decryptUpdate, bytesToBase64, base64ToBytes } from '../crypto/crypto';

export interface ProviderStatus {
  connected: boolean;
  synced: boolean;
  peerCount: number;
  activePeers: string[];
}

export class EncryptedWebrtcProvider {
  public doc: Y.Doc;
  public roomName: string;
  public teamKey: Uint8Array;
  public username: string;
  public awareness: awarenessProtocol.Awareness;
  
  private myPeerId: string;
  private ws: WebSocket | null = null;
  private peers = new Map<string, {
    pc: RTCPeerConnection;
    dc: RTCDataChannel | null;
    synced: boolean;
  }>();
  
  private statusListeners = new Set<(status: ProviderStatus) => void>();
  private wsConnected = false;
  private destroyed = false;
  
  private iceServers = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' }
  ];

  constructor(doc: Y.Doc, roomName: string, teamKey: Uint8Array, username: string) {
    this.doc = doc;
    this.roomName = roomName;
    this.teamKey = teamKey;
    this.username = username;
    this.awareness = new awarenessProtocol.Awareness(doc);
    
    // Generate a random Peer ID
    this.myPeerId = 'peer-' + Math.random().toString(36).substring(2, 11);
    
    // Bind doc updates
    this.doc.on('update', this.onDocUpdate);
    
    // Bind awareness updates
    this.awareness.on('update', this.onAwarenessUpdate);
    
    // Set local awareness state
    this.awareness.setLocalState({
      user: {
        name: username,
        color: this.getRandomColor()
      }
    });

    // Initialize WebSockets signaling
    this.connectSignaling();
    
    // Send periodic pings to keep signaling channel alive and discover peers
    const interval = setInterval(() => {
      if (this.destroyed) {
        clearInterval(interval);
        return;
      }
      this.broadcastPing();
    }, 10000);
  }

  private getRandomColor(): string {
    const colors = ['#f87171', '#fb923c', '#fbbf24', '#34d399', '#2dd4bf', '#60a5fa', '#818cf8', '#c084fc', '#f472b6'];
    return colors[Math.floor(Math.random() * colors.length)];
  }

  public onStatus(cb: (status: ProviderStatus) => void) {
    this.statusListeners.add(cb);
    this.emitStatus();
    return () => this.statusListeners.delete(cb);
  }

  private emitStatus() {
    const activePeers = Array.from(this.peers.entries())
      .filter(([_, info]) => info.dc && info.dc.readyState === 'open')
      .map(([peerId]) => peerId);

    const status: ProviderStatus = {
      connected: this.wsConnected,
      synced: activePeers.length === 0 || Array.from(this.peers.values()).every(p => !p.dc || p.synced),
      peerCount: activePeers.length,
      activePeers
    };
    
    this.statusListeners.forEach(listener => listener(status));
  }

  private connectSignaling() {
    if (this.destroyed) return;
    
    this.ws = new WebSocket('wss://signaling.yjs.dev');
    
    this.ws.onopen = () => {
      this.wsConnected = true;
      this.emitStatus();
      
      // Subscribe to room
      this.sendSignaling({
        type: 'subscribe',
        topics: [this.roomName]
      });
      
      // Announce presence
      this.broadcastPing();
    };
    
    this.ws.onmessage = async (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.type === 'publish' && message.topic === this.roomName) {
          // Decrypt payload
          const encryptedBytes = base64ToBytes(message.data);
          const decryptedBytes = decryptUpdate(encryptedBytes, this.teamKey);
          const signalData = JSON.parse(new TextDecoder().decode(decryptedBytes));
          
          // Ignore our own messages
          if (signalData.from === this.myPeerId) return;
          
          await this.handleSignal(signalData);
        }
      } catch (err) {
        // Suppress decryption errors for unrelated rooms or invalid keys
      }
    };
    
    this.ws.onclose = () => {
      this.wsConnected = false;
      this.emitStatus();
      // Reconnect
      setTimeout(() => this.connectSignaling(), 5000);
    };
  }

  private sendSignaling(msg: any) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private encryptAndPublish(payload: any) {
    try {
      payload.from = this.myPeerId;
      const text = JSON.stringify(payload);
      const encoded = new TextEncoder().encode(text);
      const encrypted = encryptUpdate(encoded, this.teamKey);
      const base64 = bytesToBase64(encrypted);
      
      this.sendSignaling({
        type: 'publish',
        topic: this.roomName,
        data: base64
      });
    } catch (e) {
      console.error('Failed to encrypt signal payload', e);
    }
  }

  private broadcastPing() {
    this.encryptAndPublish({ type: 'ping' });
  }

  private async handleSignal(signal: any) {
    const { from, type, to } = signal;
    
    // If the signal is directed to someone else, ignore
    if (to && to !== this.myPeerId) return;
    
    if (type === 'ping') {
      // Respond with pong
      this.encryptAndPublish({ type: 'pong', to: from });
      // Initiate WebRTC connection if we are the initiator (smaller peerId)
      if (this.myPeerId < from) {
        await this.initiatePeerConnection(from);
      }
    } else if (type === 'pong') {
      if (this.myPeerId < from) {
        await this.initiatePeerConnection(from);
      }
    } else if (type === 'offer') {
      await this.handleOffer(from, signal.sdp);
    } else if (type === 'answer') {
      const peer = this.peers.get(from);
      if (peer) {
        await peer.pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
      }
    } else if (type === 'ice-candidate') {
      const peer = this.peers.get(from);
      if (peer && signal.candidate) {
        await peer.pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
      }
    }
  }

  private async initiatePeerConnection(peerId: string) {
    if (this.peers.has(peerId)) return;
    
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    const dc = pc.createDataChannel('yjs-sync');
    
    const peerInfo = { pc, dc, synced: false };
    this.peers.set(peerId, peerInfo);
    
    this.setupDataChannel(peerId, dc);
    this.setupPeerConnection(peerId, pc);
    
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    
    this.encryptAndPublish({
      type: 'offer',
      to: peerId,
      sdp: offer
    });
  }

  private async handleOffer(peerId: string, sdp: RTCSessionDescriptionInit) {
    if (this.peers.has(peerId)) {
      // Peer connection already exists, clean it up
      this.cleanupPeer(peerId);
    }
    
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    const peerInfo = { pc, dc: null as RTCDataChannel | null, synced: false };
    this.peers.set(peerId, peerInfo);
    
    pc.ondatachannel = (event) => {
      peerInfo.dc = event.channel;
      this.setupDataChannel(peerId, event.channel);
    };
    
    this.setupPeerConnection(peerId, pc);
    
    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    
    this.encryptAndPublish({
      type: 'answer',
      to: peerId,
      sdp: answer
    });
  }

  private setupPeerConnection(peerId: string, pc: RTCPeerConnection) {
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.encryptAndPublish({
          type: 'ice-candidate',
          to: peerId,
          candidate: event.candidate
        });
      }
    };
    
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        this.cleanupPeer(peerId);
      }
    };
  }

  private setupDataChannel(peerId: string, dc: RTCDataChannel) {
    dc.binaryType = 'arraybuffer';
    
    dc.onopen = () => {
      this.emitStatus();
      
      // Start Yjs document synchronization
      // Send our state vector so the peer knows what updates we have
      const stateVector = Y.encodeStateVector(this.doc);
      this.sendToPeer(peerId, {
        type: 'yjs-sync-step-1',
        sv: bytesToBase64(stateVector)
      });
      
      // Send our current awareness state
      const localAwareness = awarenessProtocol.encodeAwarenessUpdate(this.awareness, [this.awareness.clientID]);
      this.sendToPeer(peerId, {
        type: 'awareness-update',
        data: bytesToBase64(localAwareness)
      });
    };
    
    dc.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        this.handlePeerMessage(peerId, payload);
      } catch (err) {
        console.error('Error handling data channel message', err);
      }
    };
    
    dc.onclose = () => {
      this.cleanupPeer(peerId);
    };
  }

  private sendToPeer(peerId: string, payload: any) {
    const peer = this.peers.get(peerId);
    if (peer && peer.dc && peer.dc.readyState === 'open') {
      peer.dc.send(JSON.stringify(payload));
    }
  }

  private handlePeerMessage(peerId: string, payload: any) {
    const { type } = payload;
    
    if (type === 'yjs-sync-step-1') {
      const remoteSv = base64ToBytes(payload.sv);
      // Calculate changes the remote peer is missing
      const update = Y.encodeStateAsUpdate(this.doc, remoteSv);
      // Send them to the remote peer
      const encryptedUpdate = encryptUpdate(update, this.teamKey);
      
      this.sendToPeer(peerId, {
        type: 'yjs-sync-step-2',
        update: bytesToBase64(encryptedUpdate)
      });
      
      // Also request their update by sending our state vector
      const mySv = Y.encodeStateVector(this.doc);
      this.sendToPeer(peerId, {
        type: 'yjs-sync-step-1-reply',
        sv: bytesToBase64(mySv)
      });
    } else if (type === 'yjs-sync-step-1-reply') {
      const remoteSv = base64ToBytes(payload.sv);
      const update = Y.encodeStateAsUpdate(this.doc, remoteSv);
      const encryptedUpdate = encryptUpdate(update, this.teamKey);
      
      this.sendToPeer(peerId, {
        type: 'yjs-sync-step-2',
        update: bytesToBase64(encryptedUpdate)
      });
    } else if (type === 'yjs-sync-step-2') {
      const encryptedUpdate = base64ToBytes(payload.update);
      const decryptedUpdate = decryptUpdate(encryptedUpdate, this.teamKey);
      
      // Apply update locally, originating from this provider to prevent loops
      Y.applyUpdate(this.doc, decryptedUpdate, this);
      
      const peer = this.peers.get(peerId);
      if (peer) {
        peer.synced = true;
        this.emitStatus();
      }
    } else if (type === 'yjs-update') {
      const encryptedUpdate = base64ToBytes(payload.update);
      const decryptedUpdate = decryptUpdate(encryptedUpdate, this.teamKey);
      
      Y.applyUpdate(this.doc, decryptedUpdate, this);
    } else if (type === 'awareness-update') {
      const encryptedAwareness = base64ToBytes(payload.data);
      const decryptedAwareness = decryptUpdate(encryptedAwareness, this.teamKey);
      
      awarenessProtocol.applyAwarenessUpdate(this.awareness, decryptedAwareness, peerId);
    }
  }

  private onDocUpdate = (update: Uint8Array, origin: any) => {
    if (origin === this) return; // Ignore updates that came from this provider
    
    // Encrypt the update
    const encrypted = encryptUpdate(update, this.teamKey);
    const base64 = bytesToBase64(encrypted);
    
    // Broadcast to all connected WebRTC peers
    for (const [peerId, peer] of this.peers.entries()) {
      if (peer.dc && peer.dc.readyState === 'open') {
        this.sendToPeer(peerId, {
          type: 'yjs-update',
          update: base64
        });
      }
    }
  };

  private onAwarenessUpdate = (_: any, origin: any) => {
    if (origin === 'local') {
      // Encode local awareness changes
      const update = awarenessProtocol.encodeAwarenessUpdate(this.awareness, [this.awareness.clientID]);
      const encrypted = encryptUpdate(update, this.teamKey);
      const base64 = bytesToBase64(encrypted);
      
      // Broadcast awareness update
      for (const [peerId, peer] of this.peers.entries()) {
        if (peer.dc && peer.dc.readyState === 'open') {
          this.sendToPeer(peerId, {
            type: 'awareness-update',
            data: base64
          });
        }
      }
    }
  };

  private cleanupPeer(peerId: string) {
    const peer = this.peers.get(peerId);
    if (peer) {
      try {
        peer.dc?.close();
        peer.pc.close();
      } catch (e) {}
      this.peers.delete(peerId);
      
      // Clean up remote awareness state for this client
      //awarenessProtocol.removeAwarenessStates(this.awareness, [peerId], this);
      
      this.emitStatus();
    }
  }

  public destroy() {
    this.destroyed = true;
    
    // Unbind listeners
    this.doc.off('update', this.onDocUpdate);
    this.awareness.off('update', this.onAwarenessUpdate);
    
    // Close signaling WS
    if (this.ws) {
      this.ws.close();
    }
    
    // Close all peer connections
    for (const peerId of this.peers.keys()) {
      this.cleanupPeer(peerId);
    }
    
    this.statusListeners.clear();
  }
}
