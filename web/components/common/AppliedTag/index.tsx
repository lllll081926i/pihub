import React from 'react';
import { Tag } from 'antd';
import { CheckCircleFilled } from '@ant-design/icons';

interface AppliedTagProps {
  children?: React.ReactNode;
}

const AppliedTag: React.FC<AppliedTagProps> = ({ children }) => {
  return (
    <Tag color="success" icon={<CheckCircleFilled />}>
      {children ?? 'Applied'}
    </Tag>
  );
};

export default AppliedTag;