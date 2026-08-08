import { useMcpStore } from '../stores/mcpStore';

export const useMcpTools = () => {
  const { tools } = useMcpStore();
  return { tools };
};

export default useMcpTools;
