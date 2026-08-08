import React from 'react';

import { GlobalPromptSettings } from '@/features/coding/shared/prompt';
import { piPromptApi } from '@/services/piPromptApi';

interface PiPromptSectionProps {
  onUpdated: () => Promise<void>;
}

const PiPromptSection: React.FC<PiPromptSectionProps> = ({ onUpdated }) => {
  return (
    <GlobalPromptSettings
      translationKeyPrefix="pi.prompt"
      service={piPromptApi}
      collapseKey="pi-prompt"
      variant="flat"
      onUpdated={onUpdated}
    />
  );
};

export default PiPromptSection;