import { message } from 'antd';
import { useTranslation } from 'react-i18next';
import { useMcpStore } from '../stores/mcpStore';
import * as mcpApi from '../services/mcpApi';
import type { CreateMcpServerInput, UpdateMcpServerInput } from '../types';

export const useMcpActions = () => {
  const { t } = useTranslation();
  const { addServer, updateServer, removeServer, fetchServers } = useMcpStore();

  const createServer = async (input: CreateMcpServerInput) => {
    try {
      const server = await mcpApi.createMcpServer(input);
      addServer(server);
      message.success(t('mcp.serverCreated'));
      return server;
    } catch (error) {
      message.error(t('mcp.serverCreateFailed') + ': ' + String(error));
      throw error;
    }
  };

  const editServer = async (serverId: string, input: UpdateMcpServerInput) => {
    try {
      const server = await mcpApi.updateMcpServer(serverId, input);
      updateServer(server);
      message.success(t('mcp.serverUpdated'));
      return server;
    } catch (error) {
      message.error(t('mcp.serverUpdateFailed') + ': ' + String(error));
      throw error;
    }
  };

  const deleteServer = async (serverId: string) => {
    try {
      await mcpApi.deleteMcpServer(serverId);
      removeServer(serverId);
      message.success(t('mcp.serverDeleted'));
    } catch (error) {
      message.error(t('mcp.serverDeleteFailed') + ': ' + String(error));
      throw error;
    }
  };

  const toggleTool = async (serverId: string, toolKey: string) => {
    try {
      const isEnabled = await mcpApi.toggleMcpTool(serverId, toolKey);
      // Refresh servers to get updated state
      await fetchServers();
      return isEnabled;
    } catch (error) {
      message.error(t('mcp.toggleToolFailed') + ': ' + String(error));
      throw error;
    }
  };

  const reorderServers = async (ids: string[]) => {
    try {
      await mcpApi.reorderMcpServers(ids);
      // Refresh to get updated order
      await fetchServers();
    } catch (error) {
      message.error(t('mcp.reorderFailed') + ': ' + String(error));
      throw error;
    }
  };

  const syncAll = async () => {
    try {
      const results = await mcpApi.syncMcpAll();
      const failed = results.filter((r) => !r.success);
      if (failed.length > 0) {
        message.warning(t('mcp.syncPartialFailed', { count: failed.length }));
      } else {
        message.success(t('mcp.syncAllSuccess'));
      }
      await fetchServers();
      return results;
    } catch (error) {
      message.error(t('mcp.syncFailed') + ': ' + String(error));
      throw error;
    }
  };

  return {
    createServer,
    editServer,
    deleteServer,
    toggleTool,
    reorderServers,
    syncAll,
  };
};

export default useMcpActions;
