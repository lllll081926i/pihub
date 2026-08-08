import React from 'react';
import allApiHubIcon from '@/assets/all-api-hub.png';

interface AllApiHubIconProps {
  size?: number;
  className?: string;
}

const AllApiHubIcon: React.FC<AllApiHubIconProps> = ({ size = 16, className }) => {
  return (
    <img
      src={allApiHubIcon}
      alt="All API Hub"
      width={size}
      height={size}
      className={className}
      style={{ borderRadius: 2, objectFit: 'contain' }}
    />
  );
};

export default AllApiHubIcon;
