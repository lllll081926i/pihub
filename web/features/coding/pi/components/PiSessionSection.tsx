import React from 'react';

import { SessionManagerPanel } from '@/features/coding/shared/sessionManager';

const PiSessionSection: React.FC = () => {
  return <SessionManagerPanel tool="pi" flat />;
};

export default PiSessionSection;