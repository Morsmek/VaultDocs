import * as Y from 'yjs';
import * as awarenessProtocol from 'y-protocols/awareness.js';
import { encryptUpdate, decryptUpdate, bytesToBase64, base64ToBytes } from '../crypto/crypto';

export interface ProviderStatus {
  /** WebSocket signaling channel is open */
  connected: boolean;
  /** At least one peer data channel is open and initial sync completed */
  synced: boolean;
  peerCount: number;
  activePeers: string[];
  /** Human-readable connection phase */
  phase: 'offline' | 'connecting' | 'online' | 'synced';
  lastError?: string;
}

export interface PeerUser {
  peerId: string;
  name: string;
  color: string;
}

function buildIceServers(): RTCIceServer[] {
  const servers: RTCIceServer[] = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' }
  ];

  const turnUrl = import.meta.env.VITE_TURN_URL as string | undefined;
  if (turnUrl) {
    servers.push({
      urls: turnUrl,
      username: (import.meta.env.VITE_TURN_USERNAME as string) || undefined,
      credential: (import.meta.env.VITE_TURN_CREDENTIAL as string) || undefined
    });
  }

  return servers;
}

function getSignalingUrl(): string {
  const fromEnv = import.meta.env.VITE_SIGNALING_URL as string | undefined;
  if (fromEnv) return fromEnv;
  // Default to the self-hosted relay on the same origin (Cloudflare Durable Object).
  // The old public default wss://signaling.yjs.dev no longer exists (DNS record removed).
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/signaling`;
}

/**
 * Room name: team + doc so rooms aren't trivially guessable as bare doc-ids.
 */
export function buildRoomName(teamId: string, docId: string): string {
  return `vd:${teamId}:${docId}`;
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
  private peerUserListeners = new Set<(peers: PeerUser[]) => void>();
  private wsConnected = false;
  private destroyed = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private lastError?: string;
  private iceServers = buildIceServers();

  constructor(doc: Y.Doc, roomName: string, teamKey: Uint8Array, username: string) {
    this.doc = doc;
    this.roomName = roomName;
    this.teamKey = teamKey;
    this.username = username;
    this.awareness = new awarenessProtocol.Awareness(doc);
    
    this.myPeerId = 'peer-' + Math.random().toString(36).substring(2, 11);
    
    this.doc.on('update', this.onDocUpdate);
    this.awareness.on('update', this.onAwarenessUpdate);
    
    this.awareness.setLocalState({
      user: {
        name: username,
        color: this.getRandomColor()
      }
    });

    this.connectSignaling();
    
    this.pingInterval = setInterval(() => {
      if (this.destroyed) return;
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

  public onPeerUsers(cb: (peers: PeerUser[]) => void) {
    this.peerUserListeners.add(cb);
    this.emitPeerUsers();
    return () => this.peerUserListeners.delete(cb);
  }

  private emitPeerUsers() {
    const states = this.awareness.getStates();
    const users: PeerUser[] = [];
    states.forEach((state, clientId) => {
      if (clientId === this.awareness.clientID) return;
      const user = state?.user as { name?: string; color?: string } | undefined;
      if (!user) return;
      users.push({
        peerId: String(clientId),
        name: user.name || 'Peer',
        color: user.color || '#0066ff'
      });
    });
    this.peerUserListeners.forEach((listener) => listener(users));
  }

  private emitStatus() {
    const activePeers = Array.from(this.peers.entries())
      .filter(([, info]) => info.dc && info.dc.readyState === 'open')
      .map(([peerId]) => peerId);

    const allSynced =
      activePeers.length > 0 &&
      Array.from(this.peers.values()).every((p) => !p.dc || p.dc.readyState !== 'open' || p.synced);

    let phase: ProviderStatus['phase'] = 'offline';
    if (this.wsConnected && activePeers.length === 0) phase = 'online';
    else if (this.wsConnected && allSynced) phase = 'synced';
    else if (this.wsConnected || activePeers.length > 0) phase = 'connecting';
    else if (!this.wsConnected && !this.destroyed) phase = 'connecting';

    const status: ProviderStatus = {
      connected: this.wsConnected,
      synced: allSynced || activePeers.length === 0,
      peerCount: activePeers.length,
      activePeers,
      phase: this.wsConnected ? (allSynced && activePeers.length > 0 ? 'synced' : activePeers.length > 0 ? 'connecting' : 'online') : phase,
      lastError: this.lastError
    };
    
    this.statusListeners.forEach((listener) => listener(status));
  }

  private connectSignaling() {
    if (this.destroyed) return;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    
    try {
      this.ws = new WebSocket(getSignalingUrl());
    } catch {
      this.lastError = 'Failed to open signaling WebSocket';
      this.emitStatus();
      this.scheduleReconnect();
      return;
    }
    
    this.ws.onopen = () => {
      this.wsConnected = true;
      this.lastError = undefined;
      this.emitStatus();
      
      this.sendSignaling({
        type: 'subscribe',
        topics: [this.roomName]
      });
      
      this.broadcastPing();
    };
    
    this.ws.onmessage = async (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.type === 'publish' && message.topic === this.roomName) {
          const encryptedBytes = base64ToBytes(message.data);
          const decryptedBytes = decryptUpdate(encryptedBytes, this.teamKey);
          const signalData = JSON.parse(new TextDecoder().decode(decryptedBytes));
          
          if (signalData.from === this.myPeerId) return;
          
          await this.handleSignal(signalData);
        }
      } catch {
        // Suppress decryption errors for unrelated rooms or invalid keys
      }
    };
    
    this.ws.onerror = () => {
      this.lastError = 'Signaling connection error (check network / VITE_SIGNALING_URL)';
      this.emitStatus();
    };

    this.ws.onclose = () => {
      this.wsConnected = false;
      this.ws = null;
      this.emitStatus();
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect() {
    if (this.destroyed) return;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connectSignaling();
    }, 5000);
  }

  private sendSignaling(msg: Record<string, unknown>) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private encryptAndPublish(payload: Record<string, unknown>) {
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

  private async handleSignal(signal: {
    from: string;
    type: string;
    to?: string;
    sdp?: RTCSessionDescriptionInit;
    candidate?: RTCIceCandidateInit;
  }) {
    const { from, type, to } = signal;
    
    if (to && to !== this.myPeerId) return;
    
    if (type === 'ping') {
      this.encryptAndPublish({ type: 'pong', to: from });
      if (this.myPeerId < from) {
        await this.initiatePeerConnection(from);
      }
    } else if (type === 'pong') {
      if (this.myPeerId < from) {
        await this.initiatePeerConnection(from);
      }
    } else if (type === 'offer' && signal.sdp) {
      await this.handleOffer(from, signal.sdp);
    } else if (type === 'answer' && signal.sdp) {
      const peer = this.peers.get(from);
      if (peer) {
        try {
          await peer.pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
        } catch (e) {
          console.warn('setRemoteDescription(answer) failed', e);
        }
      }
    } else if (type === 'ice-candidate' && signal.candidate) {
      const peer = this.peers.get(from);
      if (peer) {
        try {
          await peer.pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
        } catch {
          // Candidate may arrive before remote description
        }
      }
    }
  }

  private async initiatePeerConnection(peerId: string) {
    if (this.peers.has(peerId) || this.destroyed) return;
    
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    const dc = pc.createDataChannel('yjs-sync');
    
    const peerInfo = { pc, dc, synced: false };
    this.peers.set(peerId, peerInfo);
    
    this.setupDataChannel(peerId, dc);
    this.setupPeerConnection(peerId, pc);
    
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      
      this.encryptAndPublish({
        type: 'offer',
        to: peerId,
        sdp: offer
      });
    } catch (e) {
      console.error('Failed to create offer', e);
      this.cleanupPeer(peerId);
    }
  }

  private async handleOffer(peerId: string, sdp: RTCSessionDescriptionInit) {
    if (this.destroyed) return;
    if (this.peers.has(peerId)) {
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
    
    try {
      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      
      this.encryptAndPublish({
        type: 'answer',
        to: peerId,
        sdp: answer
      });
    } catch (e) {
      console.error('Failed to handle offer', e);
      this.cleanupPeer(peerId);
    }
  }

  private setupPeerConnection(peerId: string, pc: RTCPeerConnection) {
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.encryptAndPublish({
          type: 'ice-candidate',
          to: peerId,
          candidate: event.candidate.toJSON()
        });
      }
    };
    
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') {
        this.lastError = 'WebRTC failed (NAT/firewall). Configure VITE_TURN_URL for restrictive networks.';
        this.emitStatus();
      }
      if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        this.cleanupPeer(peerId);
      }
    };
  }

  private setupDataChannel(peerId: string, dc: RTCDataChannel) {
    dc.binaryType = 'arraybuffer';
    
    dc.onopen = () => {
      this.emitStatus();
      
      const stateVector = Y.encodeStateVector(this.doc);
      this.sendToPeer(peerId, {
        type: 'yjs-sync-step-1',
        sv: bytesToBase64(stateVector)
      });
      
      // Full state as fallback so late joiners always get content
      const fullState = Y.encodeStateAsUpdate(this.doc);
      const encryptedFull = encryptUpdate(fullState, this.teamKey);
      this.sendToPeer(peerId, {
        type: 'yjs-sync-step-2',
        update: bytesToBase64(encryptedFull)
      });

      const localAwareness = awarenessProtocol.encodeAwarenessUpdate(this.awareness, [this.awareness.clientID]);
      const encryptedAwareness = encryptUpdate(localAwareness, this.teamKey);
      this.sendToPeer(peerId, {
        type: 'awareness-update',
        data: bytesToBase64(encryptedAwareness)
      });
    };
    
    dc.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data as string);
        this.handlePeerMessage(peerId, payload);
      } catch (err) {
        console.error('Error handling data channel message', err);
      }
    };
    
    dc.onclose = () => {
      this.cleanupPeer(peerId);
    };
  }

  private sendToPeer(peerId: string, payload: Record<string, unknown>) {
    const peer = this.peers.get(peerId);
    if (peer && peer.dc && peer.dc.readyState === 'open') {
      peer.dc.send(JSON.stringify(payload));
    }
  }

  private handlePeerMessage(peerId: string, payload: {
    type: string;
    sv?: string;
    update?: string;
    data?: string;
  }) {
    const { type } = payload;
    
    if (type === 'yjs-sync-step-1' && payload.sv) {
      const remoteSv = base64ToBytes(payload.sv);
      const update = Y.encodeStateAsUpdate(this.doc, remoteSv);
      const encryptedUpdate = encryptUpdate(update, this.teamKey);
      
      this.sendToPeer(peerId, {
        type: 'yjs-sync-step-2',
        update: bytesToBase64(encryptedUpdate)
      });
      
      const mySv = Y.encodeStateVector(this.doc);
      this.sendToPeer(peerId, {
        type: 'yjs-sync-step-1-reply',
        sv: bytesToBase64(mySv)
      });
    } else if (type === 'yjs-sync-step-1-reply' && payload.sv) {
      const remoteSv = base64ToBytes(payload.sv);
      const update = Y.encodeStateAsUpdate(this.doc, remoteSv);
      const encryptedUpdate = encryptUpdate(update, this.teamKey);
      
      this.sendToPeer(peerId, {
        type: 'yjs-sync-step-2',
        update: bytesToBase64(encryptedUpdate)
      });
    } else if (type === 'yjs-sync-step-2' && payload.update) {
      const encryptedUpdate = base64ToBytes(payload.update);
      const decryptedUpdate = decryptUpdate(encryptedUpdate, this.teamKey);
      
      Y.applyUpdate(this.doc, decryptedUpdate, this);
      
      const peer = this.peers.get(peerId);
      if (peer) {
        peer.synced = true;
        this.emitStatus();
      }
    } else if (type === 'yjs-update' && payload.update) {
      const encryptedUpdate = base64ToBytes(payload.update);
      const decryptedUpdate = decryptUpdate(encryptedUpdate, this.teamKey);
      
      Y.applyUpdate(this.doc, decryptedUpdate, this);
    } else if (type === 'awareness-update' && payload.data) {
      try {
        const encryptedAwareness = base64ToBytes(payload.data);
        const decryptedAwareness = decryptUpdate(encryptedAwareness, this.teamKey);
        
        awarenessProtocol.applyAwarenessUpdate(this.awareness, decryptedAwareness, peerId);
        this.emitPeerUsers();
      } catch {
        // Ignore bad awareness payloads
      }
    }
  }

  private onDocUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === this) return;
    
    const encrypted = encryptUpdate(update, this.teamKey);
    const base64 = bytesToBase64(encrypted);
    
    for (const [peerId, peer] of this.peers.entries()) {
      if (peer.dc && peer.dc.readyState === 'open') {
        this.sendToPeer(peerId, {
          type: 'yjs-update',
          update: base64
        });
      }
    }
  };

  private onAwarenessUpdate = (
    { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown
  ) => {
    this.emitPeerUsers();

    const changedClients = added.concat(updated).concat(removed);
    const includesLocal = changedClients.includes(this.awareness.clientID);

    // y-protocols emits origin 'local' for setLocalState; also cover clientID in changed set
    if (origin === 'local' || (includesLocal && origin !== this)) {
      try {
        const update = awarenessProtocol.encodeAwarenessUpdate(this.awareness, [this.awareness.clientID]);
        const encrypted = encryptUpdate(update, this.teamKey);
        const base64 = bytesToBase64(encrypted);

        for (const [peerId, peer] of this.peers.entries()) {
          if (peer.dc && peer.dc.readyState === 'open') {
            this.sendToPeer(peerId, {
              type: 'awareness-update',
              data: base64
            });
          }
        }
      } catch {
        // ignore
      }
    }
  };

  private cleanupPeer(peerId: string) {
    const peer = this.peers.get(peerId);
    if (peer) {
      try {
        peer.dc?.close();
        peer.pc.close();
      } catch {
        // ignore
      }
      this.peers.delete(peerId);
      this.emitStatus();
      this.emitPeerUsers();
    }
  }

  public destroy() {
    this.destroyed = true;
    
    this.doc.off('update', this.onDocUpdate);
    this.awareness.off('update', this.onAwarenessUpdate);

    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.onmessage = null;
      this.ws.onerror = null;
      try {
        this.ws.close();
      } catch {
        // ignore
      }
      this.ws = null;
    }
    
    for (const peerId of [...this.peers.keys()]) {
      this.cleanupPeer(peerId);
    }
    
    try {
      this.awareness.setLocalState(null);
      this.awareness.destroy();
    } catch {
      // ignore
    }

    this.statusListeners.clear();
    this.peerUserListeners.clear();
  }
}
