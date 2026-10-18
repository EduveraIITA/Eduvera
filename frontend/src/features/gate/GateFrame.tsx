import type { ReactNode } from 'react';
import { ClipboardCheck, Home, LogOut, MoreHorizontal } from 'lucide-react';
import { Link } from 'react-router-dom';
import { OperationsShell } from '../../pages/operations/OperationsShell';
import { SchoolBrand } from '../school/SchoolBrand';
import type { SchoolMembership } from '../auth/AuthContext';
import { useAuth } from '../auth/AuthContext';
import { isGateOnlyMember } from '../auth/staffAccess';

type GateSection = 'home' | 'approvals';
export function GateFrame({ member, hindi, children, languageControl, activeSection = 'home', approvalCount = 0, onSectionChange }: { member: SchoolMembership; hindi: boolean; children: ReactNode; languageControl?: ReactNode; activeSection?: GateSection; approvalCount?: number; onSectionChange?: (section: GateSection) => void }) {
  const auth = useAuth();
  if (!isGateOnlyMember(member)) return <OperationsShell portal={member.role === 'admin' ? 'principal' : 'teacher'} active="gate" pageTitleTrailing={languageControl} title={hindi ? 'प्रवेश और निकास' : 'In & Out'} schoolName={member.school_name}>{children}</OperationsShell>;
  return <div className="gate-app" lang={hindi ? 'hi' : 'en'}>
    <header className="gate-app-bar">
      <SchoolBrand name={member.school_name} />
      <button className="gate-signout" aria-label={hindi ? 'लॉग आउट' : 'Sign out'} onClick={() => void auth.logout()}><LogOut size={18} aria-hidden="true" /><span>{hindi ? 'लॉग आउट' : 'Sign out'}</span></button>
    </header>
    <main className="gate-home"><div className="gate-language-top">{languageControl}</div>{children}</main>
    <nav className="gate-bottom-nav" aria-label={hindi ? 'मुख्य नेविगेशन' : 'Main navigation'}>
      <button className={activeSection === 'home' ? 'is-active' : ''} aria-current={activeSection === 'home' ? 'page' : undefined} onClick={() => onSectionChange?.('home')}><Home/><span>{hindi ? 'होम' : 'Home'}</span></button>
      <button className={activeSection === 'approvals' ? 'is-active' : ''} aria-current={activeSection === 'approvals' ? 'page' : undefined} onClick={() => onSectionChange?.('approvals')}><span className="gate-nav-icon"><ClipboardCheck/>{approvalCount > 0 ? <small>{approvalCount}</small> : null}</span><span>{hindi ? 'अनुमतियाँ' : 'Approvals'}</span></button>
      <Link to="/teacher/more"><MoreHorizontal/><span>{hindi ? 'और' : 'More'}</span></Link>
    </nav>
  </div>;
}
