import type { ReactNode } from 'react';
import { OperationsShell } from '../../pages/operations/OperationsShell';
import type { SchoolMembership } from '../auth/AuthContext';
import { IN_OUT_WORKSPACE_PATH } from './gateRoutes';

export function GateFrame({ member, hindi, children, languageControl }: { member: SchoolMembership; hindi: boolean; children: ReactNode; languageControl?: ReactNode }) {
  return <OperationsShell active="areas" pageTitleTrailing={languageControl} title={hindi ? 'प्रवेश और निकास' : 'In & Out'} schoolName={member.school_name} backTo={IN_OUT_WORKSPACE_PATH}>{children}</OperationsShell>;
}
