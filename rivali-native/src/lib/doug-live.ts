import { mediaDevices, MediaStream, RTCPeerConnection, RTCSessionDescription } from 'react-native-webrtc';
import { supabase } from './supabase';
const base = process.env.EXPO_PUBLIC_RIVALI_API_URL?.replace(/\/$/, '') ?? '';
export type LiveCall = { close: () => void };
export async function connectDoug(sessionId: string | undefined, onCaption: (text: string) => void, signal: AbortSignal): Promise<LiveCall> {
  if (!supabase || !base.startsWith('https://')) throw new Error('Rivali connection is not configured.');
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) throw new Error('Sign in to speak with Doug.');
  const tokenResponse = await fetch(`${base}/api/native/realtime-token`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session.access_token}` }, body: JSON.stringify({ sessionId }), signal, redirect: 'error' });
  const token = await tokenResponse.json();
  if (!tokenResponse.ok || !token.value) throw new Error(token.error ?? 'Doug could not connect.');
  let stream: MediaStream | undefined;
  let remoteStream: MediaStream | undefined;
  const peer = new RTCPeerConnection();
  const channel = peer.createDataChannel('oai-events');
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true; signal.removeEventListener('abort', close);
    channel.close(); peer.close(); stream?.getTracks().forEach(track => track.stop()); remoteStream?.getTracks().forEach(track => track.stop());
  };
  signal.addEventListener('abort', close, { once: true });
  try {
    stream = await mediaDevices.getUserMedia({ audio: true, video: false });
    if (signal.aborted) throw new Error('Call cancelled.');
    stream.getTracks().forEach(track => peer.addTrack(track, stream!));
    peer.ontrack = (event: { streams: MediaStream[] }) => { remoteStream = event.streams[0]; };
    peer.onconnectionstatechange = () => {
      if (peer.connectionState === 'failed' || peer.connectionState === 'disconnected') { onCaption('Call disconnected.'); close(); }
    };
    channel.onmessage = (event: { data: string }) => {
      try {
        const message = JSON.parse(event.data);
        if (message.type === 'response.output_audio_transcript.delta') onCaption(message.delta ?? 'Doug is speaking…');
        if (message.type === 'input_audio_buffer.speech_started') onCaption('Listening…');
        if (message.type === 'error') onCaption('Doug could not finish that response.');
      } catch { /* Ignore non-JSON transport events. */ }
    };
    channel.onopen = () => {
      onCaption('Listening…');
      channel.send(JSON.stringify({ type: 'response.create', response: { instructions: 'Briefly introduce yourself as Doug and ask what the driver wants to review. Do not invent run data.' } }));
    };
    const offer = await peer.createOffer({}); await peer.setLocalDescription(offer);
    const response = await fetch('https://api.openai.com/v1/realtime/calls', { method: 'POST', headers: { Authorization: `Bearer ${token.value}`, 'Content-Type': 'application/sdp' }, body: offer.sdp, signal });
    if (!response.ok) throw new Error('Doug could not establish the audio call.');
    await peer.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: await response.text() }));
    if (signal.aborted) throw new Error('Call cancelled.');
    return { close };
  } catch (error) { close(); throw error; }
}
