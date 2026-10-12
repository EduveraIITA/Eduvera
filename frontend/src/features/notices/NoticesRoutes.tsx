import { Navigate, useParams } from "react-router-dom";
import { NoticeComposerPage } from "./NoticeComposerPage";
import { NoticeDetailPage } from "./NoticeDetailPage";
import { NoticeListPage } from "./NoticeListPage";
import "./notices.css";

export const ParentNoticesRoute = () => <NoticeListPage portal="parent" />;
export const TeacherNoticesRoute = () => <NoticeListPage portal="teacher" />;
export const PrincipalNoticesRoute = () => <NoticeListPage portal="principal" />;
export const TeacherNoticeCreateRoute = () => <NoticeComposerPage portal="teacher" />;
export const PrincipalNoticeCreateRoute = () => <NoticeComposerPage portal="principal" />;

export function ParentNoticeDetailRoute() { const { noticeId } = useParams(); return noticeId ? <NoticeDetailPage portal="parent" noticeId={noticeId} /> : <Navigate to="/parent/notices" replace />; }
export function TeacherNoticeDetailRoute() { const { noticeId } = useParams(); return noticeId ? <NoticeDetailPage portal="teacher" noticeId={noticeId} /> : <Navigate to="/teacher/notices" replace />; }
export function PrincipalNoticeDetailRoute() { const { noticeId } = useParams(); return noticeId ? <NoticeDetailPage portal="principal" noticeId={noticeId} /> : <Navigate to="/principal/notices" replace />; }
export function TeacherNoticeEditRoute() { const { noticeId } = useParams(); return noticeId ? <NoticeComposerPage portal="teacher" noticeId={noticeId} /> : <Navigate to="/teacher/notices" replace />; }
export function PrincipalNoticeEditRoute() { const { noticeId } = useParams(); return noticeId ? <NoticeComposerPage portal="principal" noticeId={noticeId} /> : <Navigate to="/principal/notices" replace />; }

export default NoticeListPage;
