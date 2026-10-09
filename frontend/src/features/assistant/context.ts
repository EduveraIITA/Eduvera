export type AssistantPortal = 'principal' | 'teacher' | 'parent' | 'student';
export interface AssistantContext {
  portal: AssistantPortal;
  pageTitle: string;
  studentId?: string;
  permissions?: readonly string[];
}
