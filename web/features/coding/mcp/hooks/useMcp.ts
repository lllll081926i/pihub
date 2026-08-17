import { useCallback, useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useMcpStore } from '../stores/mcpStore';

export const useMcp = () => {
  const { servers, loading, fetchServers, fetchTools } = useMcpStore();
  useEffect(() => {
    void Promise.all([fetchServers(), fetchTools()]);
  }, [fetchServers, fetchTools]);

  const refresh = useCallback(async () => {
    await Promise.all([fetchServers(), fetchTools()]);
  }, [fetchServers, fetchTools]);

  // 监听外部 MCP 配置变更（如从其他页面或 tray 修改）
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen('mcp-changed', () => {
      void refresh();
    }).then((cleanup) => {
      if (disposed) {
        cleanup();
      } else {
        unlisten = cleanup;
      }
    }).catch((error) => {
      console.error('Failed to listen for MCP changes:', error);
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [refresh]);

  return {
    servers,
    loading,
    refresh,
  };
};

export default useMcp;
