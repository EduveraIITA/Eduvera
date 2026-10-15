import type { ReactNode } from 'react';
import { LogOut } from 'lucide-react';
import { OperationsShell } from '../../pages/operations/OperationsShell';
import { SchoolBrand } from '../school/SchoolBrand';
import type { SchoolMembership } from '../auth/AuthContext';
import { useAuth } from '../auth/AuthContext';
import { isGateOnlyMember } from '../auth/staffAccess';

export function GateFrame({ member, hindi, children }: { member: SchoolMembership; hindi: boolean; children: ReactNode }) {
  const auth = useAuth();
  if (!isGateOnlyMember(member)) return <OperationsShell portal={member.role === 'admin' ? 'principal' : 'teacher'} active="gate" title={hindi ? 'प्रवेश और निकास' : 'In & Out'} schoolName={member.school_name}>{children}</OperationsShell>;
  return <div className="gate-app" lang={hindi ? 'hi' : 'en'}>
    <header className="gate-app-bar">
      <SchoolBrand name={member.school_name} />
      <button className="gate-signout" aria-label={hindi ? 'लॉग आउट' : 'Sign out'} onClick={() => void auth.logout()}><LogOut size={18} aria-hidden="true" /><span>{hindi ? 'लॉग आउट' : 'Sign out'}</span></button>
    </header>
    <main className="gate-home">{children}</main>
  </div>;
}
