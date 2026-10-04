import { useEffect, useMemo, useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ChevronDown, Plus, Search, UsersRound, X } from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import { OperationsShell } from "../../pages/operations/OperationsShell";
import { profileAvatar } from "../../lib/profileAvatars";
import { enrollmentOptions, listStudents, type DirectoryStudent } from "./api";
import { EnrollmentForm } from "./EnrollmentForm";
import { GuardianAuthorityPanel } from "./GuardianAuthorityPanel";
import "./people.css";

const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

function initials(name: string) {
  return name.trim().split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
}

function PersonAvatar({ name, src, guardian = false }: { name: string; src?: string; guardian?: boolean }) {
  return <span className={`people-avatar${guardian ? " people-avatar--guardian" : ""}`}>
    {src ? <img src={src} alt="" /> : initials(name)}
  </span>;
}

function StudentContact({ student, authorityOpen, onManage }: {
  student: DirectoryStudent;
  authorityOpen: boolean;
  onManage?: (id: string) => void;
}) {
  return <details className="people-contact">
    <summary>
      <PersonAvatar name={student.name} src={profileAvatar(student.name, student.avatar_url, "student", student.admission_number)} />
      <span className="people-contact__identity">
        <strong>{student.name}</strong>
        <small>{student.class_name} · Roll {student.roll_number} · {student.admission_number}</small>
      </span>
      <span className="people-contact__family" aria-label={`${student.guardians.length} linked guardians`}>
        <span className="people-avatar-stack" aria-hidden="true">
          {student.guardians.slice(0, 2).map((guardian) => <PersonAvatar key={guardian.id} name={guardian.name} src={profileAvatar(guardian.name, guardian.avatar_url, "guardian", guardian.id)} guardian />)}
        </span>
        <small>{student.guardians.length} {student.guardians.length === 1 ? "guardian" : "guardians"}</small>
      </span>
      <ChevronDown className="people-contact__chevron" size={18} aria-hidden="true" />
    </summary>
    <div className="people-contact__details">
      <div className="people-contact__status"><span>{student.has_account ? "Student login active" : "No student login"}</span></div>
      <ul aria-label={`Guardians for ${student.name}`}>
        {student.guardians.map((guardian) => <li key={guardian.id}>
          <PersonAvatar name={guardian.name} src={profileAvatar(guardian.name, guardian.avatar_url, "guardian", guardian.id)} guardian />
          <span><strong>{guardian.name}</strong><small>{guardian.relationship} · {guardian.phone || "Phone not recorded"}</small></span>
          {onManage ? <button type="button" className="people-contact__permission" disabled={authorityOpen} aria-label={`Manage ${guardian.name}'s permissions for ${student.name}`} onClick={() => onManage(guardian.id)}>Permissions</button> : null}
        </li>)}
      </ul>
    </div>
  </details>;
}

export default function PeoplePage() {
  const auth = useAuth();
  const schools = auth.memberships.filter((membership) => membership.role === "admin" || (membership.role === "staff" && membership.permissions?.includes("sis.manage")));
  const [selected, setSelected] = useState("");
  const schoolId = selected || schools[0]?.school_id;
  const portal=auth.hasPortal("principal")?"principal":"teacher";
  return <OperationsShell portal={portal} active="home" title="Students & guardians" subtitle="School records" schoolName={schools.find((school) => school.school_id === schoolId)?.school_name} backTo={`/${portal}/more`} contentHasHeading>
    <div className="operations-stack">
      {schools.length > 1 ? <label className="people-school">School<select value={schoolId} onChange={(event) => setSelected(event.target.value)}>{schools.map((school) => <option key={school.school_id} value={school.school_id}>{school.school_name}</option>)}</select></label> : null}
      {schoolId ? <Directory key={schoolId} schoolId={schoolId} /> : <p role="alert">An active school administrator membership is required.</p>}
    </div>
  </OperationsShell>;
}

function Directory({ schoolId }: { schoolId: string }) {
  const auth=useAuth();const portal=auth.hasPortal("principal")?"principal":"teacher";
  const [search, setSearch] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [initial, setInitial] = useState<string | undefined>();
  const [adding, setAdding] = useState(false);
  const [saved, setSaved] = useState("");
  const [authorityId, setAuthorityId] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setSubmitted(search.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  const options = useQuery({ queryKey: ["school", "people", "options", schoolId], queryFn: () => enrollmentOptions(schoolId) });
  const query = useInfiniteQuery({
    queryKey: ["school", "people", "students", schoolId, submitted, initial],
    queryFn: async ({ pageParam }) => {
      const page = await listStudents(schoolId, submitted, pageParam, initial);
      if (!initial || page.results.every((student) => student.name.toUpperCase().startsWith(initial))) return page;
      const results = [...page.results];
      let cursor = page.next_cursor ?? undefined;
      while (cursor) {
        const next = await listStudents(schoolId, "", cursor);
        results.push(...next.results);
        cursor = next.next_cursor ?? undefined;
      }
      return { results: results.filter((student) => student.name.toUpperCase().startsWith(initial)), next_cursor: null };
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.next_cursor ?? undefined,
  });
  const rows = useMemo(() => query.data?.pages.flatMap((page) => page.results) ?? [], [query.data]);
  const grouped = useMemo(() => {
    const groups = new Map<string, DirectoryStudent[]>();
    for (const student of [...rows].sort((first, second) => first.name.localeCompare(second.name))) {
      const letter = student.name.trim().charAt(0).toUpperCase() || "#";
      groups.set(letter, [...(groups.get(letter) ?? []), student]);
    }
    return [...groups].map(([groupInitial, students]) => ({ initial: groupInitial, students }));
  }, [rows]);

  const chooseInitial = (value?: string) => {
    setInitial(value);
    setSearch("");
    setSubmitted("");
  };

  return <>
    <header className="people-heading people-heading--actions">
      <div className="people-authority-actions">
        <Link className="people-secondary" to={`/${portal}/students/import?school=${schoolId}`}>Import</Link>
        <button type="button" className="people-primary" disabled={!options.data?.results.length || adding} onClick={() => { setAdding(true); setSaved(""); }}><Plus size={17} />Add student</button>
      </div>
    </header>
    {saved ? <p role="status" className="people-success">{saved} is enrolled. Student and guardian records are saved.</p> : null}
    {authorityId ? <GuardianAuthorityPanel key={authorityId} schoolId={schoolId} id={authorityId} onClose={() => setAuthorityId(null)} /> : null}
    {options.isError ? <p role="alert" className="people-error">Enrollment options could not load. <button type="button" onClick={() => void options.refetch()}>Try again</button></p> : null}
    {options.data?.results.length === 0 ? <p role="status">Set up an active academic term and class before enrolling students.</p> : null}
    {adding && options.data?.results.length ? <EnrollmentForm schoolId={schoolId} options={options.data.results} onCancel={() => setAdding(false)} onSaved={(name) => { setSaved(name); setAdding(false); setInitial(undefined); setSearch(name); setSubmitted(name); }} /> : null}
    <section className="people-panel people-directory" aria-labelledby="people-directory-heading">
      <header className="people-directory__header">
        <div><h2 id="people-directory-heading">Directory</h2><span>{submitted ? "Search results" : initial ? `Names beginning with ${initial}` : "Students and linked guardians"}</span></div>
      </header>
      <label className="people-directory__search">
        <Search size={18} aria-hidden="true" />
        <span className="sr-only">Search students</span>
        <input type="search" placeholder="Search name or admission number" maxLength={80} value={search} onChange={(event) => { setSearch(event.target.value); setInitial(undefined); }} />
        {search ? <button type="button" aria-label="Clear search" onClick={() => setSearch("")}><X size={17} /></button> : null}
      </label>
      <nav className="people-alphabet" aria-label="Jump to student name initial">
        <button type="button" className={!initial && !submitted ? "is-active" : ""} aria-pressed={!initial && !submitted} onClick={() => chooseInitial()}>All</button>
        {alphabet.map((letter) => <button type="button" key={letter} className={initial === letter ? "is-active" : ""} aria-pressed={initial === letter} onClick={() => chooseInitial(letter)}>{letter}</button>)}
      </nav>
      {query.isPending ? <div className="people-directory__loading" role="status" aria-label="Loading student records">{Array.from({ length: 5 }, (_, index) => <i key={index} />)}</div> : null}
      {query.isError ? <p role="alert" className="people-error">Records could not load. <button type="button" onClick={() => void query.refetch()}>Try again</button></p> : null}
      {!query.isPending && !query.isError && !rows.length ? <div className="people-empty"><UsersRound size={24} /><p>No students match this view.</p></div> : null}
      <div className="people-contact-list">{grouped.map((group) => <section key={group.initial} aria-labelledby={`people-initial-${group.initial}`}>
        <h3 id={`people-initial-${group.initial}`}>{group.initial}</h3>
        {group.students.map((student) => <StudentContact key={student.id} student={student} authorityOpen={Boolean(authorityId)} onManage={auth.hasPortal("principal") ? setAuthorityId : undefined} />)}
      </section>)}</div>
      {query.hasNextPage ? <button type="button" className="people-secondary people-directory__more" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>{query.isFetchingNextPage ? "Loading…" : "Load more"}</button> : null}
    </section>
  </>;
}
