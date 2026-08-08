import React from 'react';
import { Spin } from 'antd';
import { useTranslation } from 'react-i18next';

import PageContainer from '@/components/common/PageContainer';
import PiExtensionsSection from '../components/PiExtensionsSection';
import { usePiRuntimeController } from '../hooks/usePiRuntimeController';

const PiExtensionsPage: React.FC = () => {
  const { t } = useTranslation();
  const ctrl = usePiRuntimeController();

  return (
    <Spin spinning={ctrl.loading}>
      <PageContainer title={t('pi.extensions.title')}>
        <PiExtensionsSection />
      </PageContainer>
    </Spin>
  );
};

export default PiExtensionsPage;
