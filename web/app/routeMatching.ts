import type {
  RouteChromeConfig,
  RouteContentPadding,
  RouteEntry,
  RouteChromeMode,
} from './routeConfig';

export interface NormalizedRouteChrome {
  mode: RouteChromeMode;
  contentPadding: RouteContentPadding;
}

export const DEFAULT_ROUTE_CHROME: NormalizedRouteChrome = {
  mode: 'default',
  contentPadding: 'default',
};

export function matchRouteEntry(routes: RouteEntry[], pathname: string): RouteEntry | undefined {
  let bestMatch: RouteEntry | undefined;

  routes.forEach((route) => {
    const isMatch = pathname === route.path || pathname.startsWith(`${route.path}/`);
    if (isMatch && (!bestMatch || route.path.length > bestMatch.path.length)) {
      bestMatch = route;
    }
  });

  return bestMatch;
}

export function normalizeRouteChrome(chrome: RouteChromeConfig | undefined): NormalizedRouteChrome {
  return {
    mode: chrome?.mode ?? DEFAULT_ROUTE_CHROME.mode,
    contentPadding: chrome?.contentPadding ?? DEFAULT_ROUTE_CHROME.contentPadding,
  };
}

export function getRouteChrome(route: RouteEntry | undefined): NormalizedRouteChrome {
  return normalizeRouteChrome(route?.chrome);
}

export function getRouteScrollKey(
  route: RouteEntry | undefined,
  pathname: string,
  search: string,
): string {
  if (!route) {
    return `${pathname}${search}`;
  }

  const chrome = getRouteChrome(route);
  if (chrome.mode === 'secondary') {
    return `${route.path}${search}`;
  }

  return route.path;
}
