export type SiteConfig = {
  title: string;
  subtitle: string;
  siteURL: string;
  keywords?: string[];
  siteStartDate?: string;

  timeZone:
    | -12
    | -11
    | -10
    | -9
    | -8
    | -7
    | -6
    | -5
    | -4
    | -3
    | -2
    | -1
    | 0
    | 1
    | 2
    | 3
    | 4
    | 5
    | 6
    | 7
    | 8
    | 9
    | 10
    | 11
    | 12;

  lang: "en" | "zh_CN";

  themeColor: {
    hue: number;
    fixed: boolean;
  };

  navbarTitle?: {
    mode?: "text-icon" | "logo";
    text: string;
    icon?: string;
    logo?: string;
  };

  toc: {
    depth: 1 | 2 | 3;
  };
  showCoverInContent: boolean;
  generateOgImages: boolean;
  favicon: Favicon[];
};

export type Favicon = {
  src: string;
  theme?: "light" | "dark";
  sizes?: string;
};

export enum LinkPreset {
  Home = 0,
  Archive = 1,
}

export type NavBarLink = {
  name: string;
  url: string;
  external?: boolean;
  icon?: string;
  children?: (NavBarLink | LinkPreset)[];
};

export type NavBarConfig = {
  links: (NavBarLink | LinkPreset)[];
};

export type ProfileConfig = {
  avatar?: string;
  name: string;
  bio?: string;
  links: {
    name: string;
    url: string;
    icon: string;
  }[];
};

export type ExpressiveCodeConfig = {
  hideDuringThemeTransition?: boolean;
};

export type MusicPlayerConfig = {
  enable: boolean;
  playlistEndpoint: string;
};

export type WidgetComponentType =
  | "profile"
  | "categories"
  | "card-toc"
  | "music-player"
  | "site-stats";

export type WidgetComponentConfig = {
  type: WidgetComponentType;
  position: "top" | "sticky";
  class?: string;
  style?: string;
  animationDelay?: number;
  responsive?: {
    hidden?: ("mobile" | "tablet" | "desktop")[];
    collapseThreshold?: number;
  };
};

export type SidebarLayoutConfig = {
  properties: WidgetComponentConfig[];
  components: {
    left: WidgetComponentType[];
    drawer: WidgetComponentType[];
  };
  defaultAnimation: {
    enable: boolean;
    baseDelay: number;
    increment: number;
  };
  responsive: {
    breakpoints: {
      mobile: number;
      tablet: number;
      desktop: number;
    };
  };
};
