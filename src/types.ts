export interface Session {
  id: string;
  title: string;
  directory: string;
  created: number;
  updated: number;
}

export interface ProjectItem {
  directory: string; // Absolute normalized path
  displayName: string; // Folder name or alias
  exists: boolean;
  pinned: boolean;
  lastActive: number;
  sessions: Session[];
}

export interface FolderHistoryItem {
  path: string;
  lastOpened: number;
}

export interface LauncherConfig {
  pinnedPaths: string[];
  customPaths: string[];
  hiddenPaths: string[];
  folderHistory: FolderHistoryItem[];
  lastOpenedPath?: string;
  autoReturnToLauncher?: boolean;
}
