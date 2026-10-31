export interface CampusTabsProps {
  hidden: boolean;
  sidebar: boolean;
  blocked: boolean;
  assistant: boolean;
  workCount: number;
  activeRoot: string;
  onTabPress(root: string): void;
  onAssistantPress(): void;
}
