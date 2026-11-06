'use client';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { useEffect, useState } from 'react';
import * as Y from 'yjs';

export const COLLAB_URL = process.env.NEXT_PUBLIC_COLLAB_URL ?? '';
/** 협업 서버 첫 동기화 대기 시간. 초과 시 REST 자동 저장 모드로 전환 */
const CONNECT_TIMEOUT_MS = 5000;

export type CollabStatus = 'disabled' | 'connecting' | 'connected' | 'disconnected' | 'unavailable';
export interface Peer { clientId: number; name: string; color: string }

export interface CollabState {
  status: CollabStatus;
  provider: HocuspocusProvider | null;
  peers: Peer[];
}

/**
 * 실시간 협업 연결. NEXT_PUBLIC_COLLAB_URL 이 없거나, 제한 시간 안에 첫 동기화가 끝나지 않으면
 * 'unavailable' → 호출 측에서 REST 자동 저장 모드로 대체한다.
 * 첫 동기화 이후의 연결 끊김은 'disconnected' 로 표시하며, 제공자가 자동 재연결 후 Yjs 상태 벡터를 교환해
 * 오프라인 중 편집 내용을 병합한다(CRDT).
 * 인증은 세션 쿠키로만 이뤄진다. token 은 Hocuspocus 인증 핸드셰이크용 자리표시자이며 서버는 값을 사용하지 않는다.
 */
export function useCollab(pageId: string, enabled: boolean): CollabState {
  const [state, setState] = useState<CollabState>({ status: COLLAB_URL && enabled ? 'connecting' : 'disabled', provider: null, peers: [] });

  useEffect(() => {
    if (!COLLAB_URL || !enabled) {
      setState({ status: 'disabled', provider: null, peers: [] });
      return;
    }
    let synced = false;
    let cancelled = false;
    const doc = new Y.Doc();
    const provider = new HocuspocusProvider({
      url: COLLAB_URL,
      name: `page:${pageId}`,
      document: doc,
      token: 'session-cookie',
      onSynced: ({ state: isSynced }) => {
        if (!isSynced || cancelled) return;
        synced = true;
        setState((s) => ({ ...s, status: 'connected', provider }));
      },
      onStatus: ({ status }) => {
        if (cancelled || !synced) return;
        setState((s) => ({ ...s, status: status === 'connected' ? 'connected' : 'disconnected' }));
      },
      onAuthenticationFailed: () => {
        if (cancelled) return;
        if (!synced) fail();
      },
      onAwarenessChange: ({ states }) => {
        if (cancelled) return;
        const peers = states
          .filter((st) => st.clientId !== doc.clientID && st.user)
          .map((st) => ({ clientId: st.clientId, name: String((st.user as { name?: string }).name ?? ''), color: String((st.user as { color?: string }).color ?? '#000') }));
        setState((s) => ({ ...s, peers }));
      },
    });
    const fail = () => {
      clearTimeout(timer);
      provider.destroy();
      setState({ status: 'unavailable', provider: null, peers: [] });
    };
    const timer = setTimeout(() => {
      if (!synced && !cancelled) fail();
    }, CONNECT_TIMEOUT_MS);
    setState({ status: 'connecting', provider: null, peers: [] });
    return () => {
      cancelled = true;
      clearTimeout(timer);
      provider.destroy();
      doc.destroy();
    };
  }, [pageId, enabled]);

  return state;
}
