import { createBrowserRouter, Navigate } from 'react-router-dom';
import MainLayout from '@/components/layout/MainLayout';
import { PAGE_ROUTES } from './routeConfig';

const RoutePlaceholder = () => null;

// 页面组件的渲染和缓存由 MainLayout 中的 KeepAliveOutlet 管理，
// 此处仅声明路径用于 URL 匹配。
// 根路径 "/" 重定向到 Pi 页面（默认子页面）。
// 新增页面请修改 routeConfig.ts，无需同时修改多处。
export const router = createBrowserRouter([
  {
    path: '/',
    element: <MainLayout />,
    children: [
      {
        index: true,
        element: <Navigate to="/coding/pi" replace />,
      },
      ...PAGE_ROUTES.map(({ path }) => ({
        path: path.replace(/^\//, ''),
        Component: RoutePlaceholder,
      })),
    ],
  },
]);
