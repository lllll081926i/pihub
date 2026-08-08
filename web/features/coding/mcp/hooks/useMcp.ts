import { useEffect, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useMcpStore } from '../stores/mcpStore';

export const useMcp = () => {
  const { servers, loading, fetchServers, fetchTools } = useMcpStore();
  const hasLoadedRef = useRef(false);

  useEffect(() => {
    if (hasLoadedRef.current) return;
    hasLoadedRef.current = true;

    const loadData = async () => {
      await fetchServers();
      await fetchTools();
    };
    loadData();
  }, [fetchServers, fetchTools]);

  // 监听外部 MCP 配置变更（如从其他页面或 tray 修改）
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    const setup = async () => {
      unlisten = await listen('mcp-changed', () => {
        fetchServers();
        fetchTools();
      });
    };
    setup();
    return () => { unlisten?.(); };
  }, [fetchServers, fetchTools]);

  return {
    servers,
    loading,
    refresh: fetchServers,
  };
};

export default useMcp;
