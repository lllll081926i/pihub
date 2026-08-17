import { create } from 'zustand';
import type { McpServer, McpTool, McpScanResult } from '../types';
import * as mcpApi from '../services/mcpApi';

let serversRequestId = 0;
let toolsRequestId = 0;

interface McpState {
  servers: McpServer[];
  tools: McpTool[];
  loading: boolean;
  scanResult: McpScanResult | null;

  // Modal states
  isSettingsModalOpen: boolean;
  isImportModalOpen: boolean;
  isImportJsonModalOpen: boolean;

  // Actions
  fetchServers: () => Promise<void>;
  fetchTools: () => Promise<void>;
  loadScanResult: () => Promise<void>;
  setServers: (servers: McpServer[]) => void;
  addServer: (server: McpServer) => void;
  updateServer: (server: McpServer) => void;
  removeServer: (serverId: string) => void;
  setSettingsModalOpen: (open: boolean) => void;
  setImportModalOpen: (open: boolean) => void;
  setImportJsonModalOpen: (open: boolean) => void;
}

export const useMcpStore = create<McpState>()((set) => ({
  servers: [],
  tools: [],
  loading: false,
  scanResult: null,
  isSettingsModalOpen: false,
  isImportModalOpen: false,
  isImportJsonModalOpen: false,

  fetchServers: async () => {
    const requestId = ++serversRequestId;
    set({ loading: true });
    try {
      const servers = await mcpApi.listMcpServers();
      if (requestId === serversRequestId) {
        set({ servers });
      }
    } catch (error) {
      console.error('Failed to fetch MCP servers:', error);
    } finally {
      if (requestId === serversRequestId) {
        set({ loading: false });
      }
    }
  },

  fetchTools: async () => {
    const requestId = ++toolsRequestId;
    try {
      const tools = await mcpApi.getMcpTools();
      if (requestId === toolsRequestId) {
        set({ tools });
      }
    } catch (error) {
      console.error('Failed to fetch MCP tools:', error);
    }
  },

  loadScanResult: async () => {
    try {
      const scanResult = await mcpApi.scanMcpServers();
      set({ scanResult });
    } catch (error) {
      console.error('Failed to scan MCP servers:', error);
    }
  },

  setServers: (servers) => set({ servers }),

  addServer: (server) => set((state) => ({ servers: [...state.servers, server] })),

  updateServer: (server) => set((state) => ({
    servers: state.servers.map((s) => (s.id === server.id ? server : s)),
  })),

  removeServer: (serverId) => set((state) => ({
    servers: state.servers.filter((s) => s.id !== serverId),
  })),

  setSettingsModalOpen: (open) => set({ isSettingsModalOpen: open }),

  setImportModalOpen: (open) => set({ isImportModalOpen: open }),

  setImportJsonModalOpen: (open) => set({ isImportJsonModalOpen: open }),
}));
