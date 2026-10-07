#!/usr/bin/env python3
"""Generate and optionally load a coherent medium-sized Indian school dataset.

The generator uses only Python's standard library.  It emits one transactional
PostgreSQL seed file, validates the object graph before writing SQL, and embeds
database-side assertions so a partial or relationally-invalid demo seed can
never be committed.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import random
import shutil
import subprocess
import sys
from datetime import date, datetime, time, timedelta, timezone
from typing import Any, Iterable, Sequence


IST = timezone(timedelta(hours=5, minutes=30))
BACKEND_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = BACKEND_ROOT / "generated" / "medium-school.sql"
DEFAULT_SUMMARY = BACKEND_ROOT / "generated" / "medium-school-summary.json"
SCHOOL_KEY = "school-cis"
SCHOOL_CODE = "cis"
SCHOOL_NAME = "Cambridge International School"


def deterministic_id(name: str) -> str:
    """Match the deterministic UUID-shaped identifiers used by the original seed."""
    digest = hashlib.sha256(f"omnischool:{name}".encode()).hexdigest()
    return f"{digest[:8]}-{digest[8:12]}-4{digest[13:16]}-a{digest[17:20]}-{digest[20:32]}"


def password_hash(password: str, rng: random.Random) -> str:
    salt = bytes(rng.randrange(256) for _ in range(24))
    derived = hashlib.scrypt(password.encode(), salt=salt, n=32768, r=8, p=1, dklen=64, maxmem=64 * 1024 * 1024)
    encode = lambda value: base64.urlsafe_b64encode(value).decode().rstrip("=")
    return f"scrypt$32768$8$1${encode(salt)}${encode(derived)}"


def load_dotenv(path: Path) -> None:
    if not path.exists():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def sql_value(value: Any) -> str:
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "TRUE" if value else "FALSE"
    if isinstance(value, (int, float)):
        return str(value)
    if isinstance(value, (dict, list)):
        value = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    if isinstance(value, (date, datetime)):
        value = value.isoformat()
    return "'" + str(value).replace("'", "''") + "'"


def batched(values: Sequence[tuple[Any, ...]], size: int = 500) -> Iterable[Sequence[tuple[Any, ...]]]:
    for start in range(0, len(values), size):
        yield values[start : start + size]


def insert_sql(
    table: str,
    columns: Sequence[str],
    rows: Sequence[tuple[Any, ...]],
    *,
    conflict: str = "",
    batch_size: int = 500,
) -> list[str]:
    statements: list[str] = []
    if not rows:
        return statements
    column_sql = ",".join(columns)
    for batch in batched(rows, batch_size):
        values_sql = ",\n".join("(" + ",".join(sql_value(value) for value in row) + ")" for row in batch)
        statements.append(f"INSERT INTO {table} ({column_sql}) VALUES\n{values_sql}{conflict};")
    return statements


def academic_year_for(day: date) -> tuple[str, date, date]:
    start_year = day.year if day.month >= 4 else day.year - 1
    return f"{start_year}-{str(start_year + 1)[-2:]}", date(start_year, 4, 1), date(start_year + 1, 3, 31)


def is_second_or_fourth_saturday(day: date) -> bool:
    return day.weekday() == 5 and ((day.day - 1) // 7 + 1) in {2, 4}


def attendance_days(as_of: date) -> list[date]:
    start = as_of - timedelta(days=60)
    school_holidays = {
        date(as_of.year, 8, 15),
        date(as_of.year, 10, 2),
    }
    return [
        start + timedelta(days=offset)
        for offset in range((as_of - start).days + 1)
        if (start + timedelta(days=offset)).weekday() != 6
        and not is_second_or_fourth_saturday(start + timedelta(days=offset))
        and start + timedelta(days=offset) not in school_holidays
    ]


FIRST_NAMES = [
    "Aadhya", "Aarushi", "Advait", "Aisha", "Akshara", "Anaya", "Anika", "Arnav", "Atharv", "Avni",
    "Diya", "Eshan", "Ira", "Ishaan", "Ishita", "Jiya", "Kabir", "Karthik", "Kiara", "Krishna",
    "Mahira", "Meher", "Mihir", "Myra", "Navya", "Neil", "Niharika", "Om", "Pari", "Pranav",
    "Rhea", "Reyansh", "Riddhi", "Riya", "Rudra", "Saanvi", "Samar", "Samaira", "Sara", "Shaurya",
    "Siya", "Tanvi", "Tara", "Vihaan", "Vivaan", "Yash", "Yuvika", "Zara", "Dev", "Isha",
]
LAST_NAMES = [
    "Agarwal", "Bansal", "Bhat", "Bose", "Chatterjee", "Chauhan", "Das", "Desai", "Dutta", "Fernandes",
    "Gupta", "Iyer", "Jain", "Joshi", "Kapoor", "Khan", "Kulkarni", "Malhotra", "Mehta", "Menon",
    "Mishra", "Mukherjee", "Nair", "Patel", "Rao", "Reddy", "Roy", "Saxena", "Sen", "Shah",
    "Sharma", "Singh", "Sinha", "Tiwari", "Varma", "Verma", "Yadav", "Naidu", "Kaur", "Pillai",
]
MOTHER_NAMES = ["Pooja", "Anjali", "Neha", "Lakshmi", "Shweta", "Rashmi", "Deepa", "Kavya", "Nisha", "Meena", "Sonal", "Rekha"]
FATHER_NAMES = ["Rajiv", "Amit", "Sanjay", "Vivek", "Rohit", "Manoj", "Arun", "Nitin", "Prakash", "Vikash", "Sameer", "Dinesh"]
BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "AB+", "O+", "O-"]
AVATARS = [
    "/assets/aarav-sharma.png",
    "/assets/ananya-iyer.png",
    "/assets/rohan-verma.png",
    "/assets/kavya-nair.png",
]

PROFILE_AVATARS = {
    "pooja.parent": "/assets/pooja-sharma.png",
    "parent.cis0103": "/assets/rashmi-joshi.png",
    "parent.cis0093": "/assets/pooja-chauhan.png",
    "meera.principal": "/assets/meera-kapoor.png",
    "kavita.staff": "/assets/kavita-mehta.png",
}


SUBJECTS = [
    ("mat", "MAT", "Mathematics", "Maths", "#2457D6", "calculator"),
    ("sci", "SCI", "Science", "Science", "#16A085", "flask-conical"),
    ("eng", "ENG", "English", "English", "#7C5CE7", "book-open"),
    ("sst", "SST", "Social Science", "Social", "#E59B35", "landmark"),
    ("hin", "HIN", "Hindi", "Hindi", "#D9638C", "languages"),
    ("csc", "CSC", "Computer Science", "Computers", "#2879B9", "monitor"),
    ("ped", "PED", "Physical Education", "PE", "#2A9D6F", "activity"),
    ("art", "ART", "Art & Design", "Art", "#A65ACB", "palette"),
]


TEACHERS = [
    ("kavita", "kavita.staff", "Kavita", "Mehta", "mat", "Middle School Mathematics Faculty"),
    ("suresh", "suresh.kulkarni", "Suresh", "Kulkarni", "mat", "Senior Mathematics Faculty"),
    ("arjun", "arjun.teacher", "Arjun", "Sen", "sci", "Middle School Science Faculty"),
    ("nandita", "nandita.rao", "Nandita", "Rao", "sci", "Senior Science Faculty"),
    ("priya", "priya.teacher", "Priya", "Iyer", "eng", "Middle School English Faculty"),
    ("daniel", "daniel.joseph", "Daniel", "Joseph", "eng", "Senior English Faculty"),
    ("farah", "farah.khan", "Farah", "Khan", "sst", "Middle School Social Science Faculty"),
    ("manish", "manish.tiwari", "Manish", "Tiwari", "sst", "Senior Social Science Faculty"),
    ("neelam", "neelam.mishra", "Neelam", "Mishra", "hin", "Middle School Hindi Faculty"),
    ("anil", "anil.sharma", "Anil", "Sharma", "hin", "Senior Hindi Faculty"),
    ("ritu", "ritu.malhotra", "Ritu", "Malhotra", "csc", "Computer Science Faculty"),
    ("joseph", "joseph.mathew", "Joseph", "Mathew", "csc", "Senior Computer Science Faculty"),
    ("vikram", "vikram.singh", "Vikram", "Singh", "ped", "Physical Education Faculty"),
    ("shalini", "shalini.das", "Shalini", "Das", "ped", "Senior Physical Education Faculty"),
    ("leena", "leena.bose", "Leena", "Bose", "art", "Art & Design Faculty"),
    ("rahul", "rahul.nair", "Rahul", "Nair", "art", "Senior Art & Design Faculty"),
]


def make_students(rng: random.Random, academic_year: str) -> list[dict[str, Any]]:
    sections = [(grade, section) for grade in range(6, 10) for section in ("A", "B")]
    fixed = {
        (7, "A", 1): ("ananya", "Ananya", "Iyer", "CIS-2023-061", "/assets/ananya-iyer.png"),
        (7, "A", 2): ("rohan", "Rohan", "Verma", "CIS-2023-052", "/assets/rohan-verma.png"),
        (7, "A", 3): ("kavya", "Kavya", "Nair", "CIS-2023-063", "/assets/kavya-nair.png"),
        (7, "A", 17): ("aarav", "Aarav", "Sharma", "CIS-2023-071", "/assets/aarav-sharma.png"),
        (7, "B", 4): ("isha", "Isha", "Patel", "CIS-2023-081", AVATARS[1]),
        (7, "B", 8): ("dev", "Dev", "Malhotra", "CIS-2023-083", AVATARS[2]),
        (7, "B", 12): ("sana", "Sana", "Khan", "CIS-2023-087", AVATARS[3]),
        (7, "B", 19): ("vivaan", "Vivaan", "Rao", "CIS-2023-091", AVATARS[0]),
        (8, "A", 3): ("myra", "Myra", "Joshi", "CIS-2022-041", AVATARS[1]),
        (8, "A", 7): ("kabir", "Kabir", "Singh", "CIS-2022-046", AVATARS[2]),
        (8, "A", 14): ("tara", "Tara", "Menon", "CIS-2022-049", AVATARS[3]),
        (8, "A", 21): ("neil", "Neil", "Dutta", "CIS-2022-055", AVATARS[0]),
    }
    used_names = {(value[1], value[2]) for value in fixed.values()}
    name_pairs = [(first, last) for first in FIRST_NAMES for last in LAST_NAMES]
    rng.shuffle(name_pairs)
    pair_index = 0
    students: list[dict[str, Any]] = []
    sequence = 1
    for grade, section in sections:
        for roll in range(1, 26):
            predefined = fixed.get((grade, section, roll))
            if predefined:
                key, first, last, admission, avatar = predefined
            else:
                while name_pairs[pair_index] in used_names:
                    pair_index += 1
                first, last = name_pairs[pair_index]
                pair_index += 1
                used_names.add((first, last))
                key = f"student-{sequence:03d}"
                admission = f"CIS-{academic_year[:4]}-{sequence:04d}"
                avatar = AVATARS[(sequence + grade + roll) % len(AVATARS)]
            birth_year = int(academic_year[:4]) - (grade + 5)
            birth = date(birth_year, rng.randint(1, 12), rng.randint(1, 28))
            user_id = deterministic_id(f"user-{key}") if key not in {"aarav", "ananya", "rohan", "kavya"} else deterministic_id(f"user-{key}")
            student_id = deterministic_id(f"student-{key}") if key not in {"aarav", "ananya", "rohan", "kavya"} else deterministic_id(f"student-{key}")
            username = f"{first.lower()}.{last.lower()}.{sequence:03d}"
            email = f"student{sequence:03d}@cambridge.example.test"
            if predefined:
                username = f"{key}.student"
                email = f"{key}.{last.lower()}@example.test" if key in {"aarav", "ananya", "rohan", "kavya"} else f"{key}@example.test"
            students.append({
                "key": key,
                "user_id": user_id,
                "student_id": student_id,
                "enrollment_id": deterministic_id(f"enrollment-{key}"),
                "first": first,
                "last": last,
                "username": username,
                "email": email,
                "admission": admission,
                "birth": birth,
                "blood_group": rng.choice(BLOOD_GROUPS),
                "phone": f"+91 9{rng.randint(1000, 9999)} {rng.randint(10000, 99999)}",
                "avatar": avatar,
                "grade": grade,
                "section": section,
                "class_key": f"{grade}{section.lower()}",
                "roll": roll,
            })
            sequence += 1
    return students


def make_guardians(students: Sequence[dict[str, Any]], rng: random.Random) -> list[dict[str, Any]]:
    guardians: list[dict[str, Any]] = []
    for index, student in enumerate(students, start=1):
        if student["key"] in {"aarav", "ananya"}:
            key, first, username, email = "pooja", "Pooja", "pooja.parent", "pooja.sharma@example.test"
            relationship = "mother" if student["key"] == "aarav" else "guardian"
        else:
            relationship = "mother" if index % 5 else "father"
            first = rng.choice(MOTHER_NAMES if relationship == "mother" else FATHER_NAMES)
            key = f"guardian-{index:03d}"
            username = f"parent.cis{index:04d}"
            email = f"parent{index:03d}@cambridge.example.test"
        user_id = deterministic_id("user-pooja") if key == "pooja" else deterministic_id(f"user-{key}")
        parent_id = deterministic_id("parent-pooja") if key == "pooja" else deterministic_id(f"parent-{key}")
        guardians.append({
            "key": key,
            "user_id": user_id,
            "parent_id": parent_id,
            "relationship_id": deterministic_id(f"guardian-{student['key']}"),
            "student_id": student["student_id"],
            "first": first,
            "last": "Sharma" if key == "pooja" else student["last"],
            "username": username,
            "email": email,
            "phone": f"+91 9{rng.randint(1000, 9999)} {rng.randint(10000, 99999)}",
            "relationship": relationship,
        })
    return guardians


def status_for(student: dict[str, Any], day_index: int, total_days: int, rng: random.Random) -> str:
    # The visible 7A leaderboard is deterministic and based on the same daily
    # points formula used by the API. Missed days are placed before recent streaks.
    fixed_missed = {
        "ananya": [],
        "rohan": [5],
        "kavya": [8, 19],
        "aarav": [4, 16, max(0, total_days - 16)],
    }
    if student["key"] in fixed_missed:
        if day_index in fixed_missed[student["key"]]:
            return "half_day" if student["key"] == "aarav" and day_index == 16 else "absent"
        return "late" if student["key"] == "aarav" and day_index in {11, total_days - 5} else "present"

    # Other 7A students deliberately stay below Aarav so the ranking is stable.
    if student["class_key"] == "7a":
        forced = {2, 10, 18, 26}
        if day_index in forced:
            return "absent" if (student["roll"] + day_index) % 3 else "excused"

    band = (student["roll"] + student["grade"] * 3 + (0 if student["section"] == "A" else 5)) % 10
    roll = rng.random()
    if band == 0:
        thresholds = (0.79, 0.83, 0.90, 0.95)
    elif band <= 2:
        thresholds = (0.87, 0.91, 0.95, 0.98)
    else:
        thresholds = (0.935, 0.96, 0.98, 0.992)
    if roll < thresholds[0]:
        return "present"
    if roll < thresholds[1]:
        return "late"
    if roll < thresholds[2]:
        return "absent"
    if roll < thresholds[3]:
        return "excused"
    return "half_day"


def local_timestamp(day: date, hour: int, minute: int) -> str:
    """A wall-clock moment on `day`, clamped so seeded history never post-dates real inserts."""
    stamp = datetime.combine(day, time(hour, minute), tzinfo=IST)
    ceiling = datetime.now(IST) - timedelta(minutes=5)
    return min(stamp, ceiling).isoformat()


def scheduled_timestamp(day: date, hour: int, minute: int) -> str:
    """An unclamped school-local timestamp for scheduled future or historical events."""
    return datetime.combine(day, time(hour, minute), tzinfo=IST).isoformat()


def add_campus_event_fixtures(
    dataset: dict[str, list[tuple[Any, ...]]],
    students: Sequence[dict[str, Any]],
    guardians: Sequence[dict[str, Any]],
    staff: Sequence[dict[str, Any]],
    principal: dict[str, Any],
    class_ids: dict[str, str],
    subject_ids: dict[str, str],
    school_id: str,
    academic_year: str,
) -> dict[str, int]:
    """Add three complete, relationally coherent event workflows.

    The completed Annual Function demonstrates event attendance without
    rewriting academic attendance.  The upcoming Class 7A excursion
    demonstrates purpose-specific guardian consent and a preparation checklist.
    Kavita Mehta's Class 7A Mathematics test demonstrates an assigned teacher's
    subject-linked class event and its mandatory event register.
    Missing RSVP, consent or event attendance remains missing rather than being
    inferred as a decline, denial or no-show.
    """
    start_year = int(academic_year[:4])
    annual_day = date(start_year, 8, 22)
    annual_rehearsal_day = annual_day - timedelta(days=1)
    picnic_day = date(start_year, 10, 10)
    class_test_day = date(start_year, 10, 1)
    class_test_day += timedelta(days=(3 - class_test_day.weekday()) % 7)  # Thursday, Mathematics P1 for 7A.
    principal_id = principal["user_id"]
    staff_by_key = {person["key"]: person for person in staff}
    guardian_by_student = {guardian["student_id"]: guardian for guardian in guardians}

    annual_id = deterministic_id("campus-event-annual-function-2026")
    picnic_id = deterministic_id("campus-event-class-7a-picnic-2026")
    class_test_id = deterministic_id("campus-event-class-7a-mathematics-test-2026")
    annual_rehearsal_id = deterministic_id("campus-event-annual-function-rehearsal-2026")
    annual_main_id = deterministic_id("campus-event-annual-function-main-2026")
    picnic_departure_id = deterministic_id("campus-event-class-7a-picnic-departure-2026")
    picnic_activity_id = deterministic_id("campus-event-class-7a-picnic-activity-2026")
    picnic_return_id = deterministic_id("campus-event-class-7a-picnic-return-2026")
    class_test_session_id = deterministic_id("campus-event-class-7a-mathematics-test-session-2026")

    annual_created = scheduled_timestamp(annual_day - timedelta(days=24), 10, 0)
    annual_published = scheduled_timestamp(annual_day - timedelta(days=14), 11, 30)
    annual_completed = scheduled_timestamp(annual_day, 21, 0)
    picnic_created = scheduled_timestamp(picnic_day - timedelta(days=20), 9, 15)
    picnic_published = scheduled_timestamp(picnic_day - timedelta(days=16), 12, 0)
    class_test_created = scheduled_timestamp(class_test_day - timedelta(days=8), 15, 30)
    class_test_published = scheduled_timestamp(class_test_day - timedelta(days=6), 16, 0)

    dataset["campus_events"].extend([
        (
            annual_id, school_id, "annual_function", "completed", "Annual Function 2026 - Udaan",
            "The school's annual music, theatre and student showcase. Attendance is expected for the school roster and recorded only in the event register.",
            "School Amphitheatre", scheduled_timestamp(annual_rehearsal_day, 15, 0), scheduled_timestamp(annual_day, 21, 0),
            "school", "mandatory", False, False, False, "none", 3, principal_id, principal_id,
            annual_published, None, None, None, principal_id, annual_completed, annual_created, annual_completed,
        ),
        (
            picnic_id, school_id, "excursion", "published", "Class 7A Discovery Picnic",
            "An optional supervised learning visit to Bannerghatta Biological Park. RSVP, guardian consent, the trip fee and required kit must be ready before departure.",
            "Bannerghatta Biological Park", scheduled_timestamp(picnic_day, 6, 30), scheduled_timestamp(picnic_day, 18, 0),
            "class_sections", "optional", True, True, True, "none", 2, principal_id, principal_id,
            picnic_published, None, None, None, None, None, picnic_created, picnic_published,
        ),
        (
            class_test_id, school_id, "class_test", "published", "Class 7A Mathematics Unit Test",
            "A 45-minute classroom assessment on fractions, decimals and ratio. Bring a sharpened pencil, ruler and geometry box.",
            "Room 204", scheduled_timestamp(class_test_day, 9, 0), scheduled_timestamp(class_test_day, 9, 45),
            "class_sections", "mandatory", False, False, False, "none", 2,
            staff_by_key["kavita"]["user_id"], staff_by_key["kavita"]["user_id"], class_test_published,
            None, None, None, None, None, class_test_created, class_test_published,
        ),
    ])
    # Payment configuration and the optional subject link are rendered as the
    # final tuple fields. Keeping the subject last preserves the established
    # validation indexes while still exercising the database payment invariant.
    dataset["campus_events"][0] += (None, None, "INR", None)
    dataset["campus_events"][1] += (185000, (picnic_day - timedelta(days=7)).isoformat(), "INR", None)
    dataset["campus_events"][2] += (None, None, "INR", subject_ids["mat"])
    dataset["campus_event_class_sections"].extend([
        (school_id, picnic_id, class_ids["7a"]),
        (school_id, class_test_id, class_ids["7a"]),
    ])

    annual_staff = [
        (staff_by_key["leena"]["user_id"], "organizer"),
        (staff_by_key["priya"]["user_id"], "duty_staff"),
        (staff_by_key["kavita"]["user_id"], "attendance_taker"),
    ]
    picnic_staff = [
        (staff_by_key["kavita"]["user_id"], "organizer"),
        (staff_by_key["vikram"]["user_id"], "duty_staff"),
        (staff_by_key["sunita"]["user_id"], "attendance_taker"),
    ]
    dataset["campus_event_staff"].extend(
        [(school_id, annual_id, user_id, role, annual_published) for user_id, role in annual_staff]
        + [(school_id, picnic_id, user_id, role, picnic_published) for user_id, role in picnic_staff]
        + [
            (school_id, class_test_id, staff_by_key["kavita"]["user_id"], "organizer", class_test_published),
        ]
    )

    dataset["campus_event_sessions"].extend([
        (
            annual_rehearsal_id, school_id, annual_id, "Performer dress rehearsal", "rehearsal", "School Amphitheatre",
            scheduled_timestamp(annual_rehearsal_day, 15, 0), scheduled_timestamp(annual_rehearsal_day, 17, 30),
            "check_in", "locked", 2, staff_by_key["kavita"]["user_id"],
            scheduled_timestamp(annual_rehearsal_day, 17, 45), None, None, None, annual_published,
            scheduled_timestamp(annual_rehearsal_day, 17, 45),
        ),
        (
            annual_main_id, school_id, annual_id, "Annual cultural programme", "general", "School Amphitheatre",
            scheduled_timestamp(annual_day, 16, 30), scheduled_timestamp(annual_day, 20, 30),
            "check_in", "locked", 2, staff_by_key["kavita"]["user_id"],
            scheduled_timestamp(annual_day, 20, 45), None, None, None, annual_published,
            scheduled_timestamp(annual_day, 20, 45),
        ),
        (
            picnic_departure_id, school_id, picnic_id, "Departure muster", "departure", "North Gate",
            scheduled_timestamp(picnic_day, 6, 45), scheduled_timestamp(picnic_day, 7, 30),
            "check_in", "open", 1, None, None, None, None, None, picnic_published, picnic_published,
        ),
        (
            picnic_activity_id, school_id, picnic_id, "Park learning trail", "activity", "Bannerghatta Biological Park",
            scheduled_timestamp(picnic_day, 10, 0), scheduled_timestamp(picnic_day, 14, 30),
            "check_in", "open", 1, None, None, None, None, None, picnic_published, picnic_published,
        ),
        (
            picnic_return_id, school_id, picnic_id, "Return and guardian handover", "return", "North Gate",
            scheduled_timestamp(picnic_day, 16, 45), scheduled_timestamp(picnic_day, 17, 45),
            "check_in_out", "open", 1, None, None, None, None, None, picnic_published, picnic_published,
        ),
        (
            class_test_session_id, school_id, class_test_id, "Mathematics unit test", "general", "Room 204",
            scheduled_timestamp(class_test_day, 9, 0), scheduled_timestamp(class_test_day, 9, 45),
            "check_in", "open", 1, None, None, None, None, None, class_test_published, class_test_published,
        ),
    ])

    annual_attendance_count = 0
    annual_rehearsal_count = 0
    for student in students:
        dataset["campus_event_participants"].append((
            school_id, annual_id, student["student_id"], "mandatory", "pending", None,
            annual_published, None, None,
        ))
        dataset["campus_event_session_participants"].append((
            school_id, annual_id, annual_main_id, student["student_id"], "mandatory",
        ))
        main_status = (
            "no_show"
            if student["roll"] % 19 == 0
            else "late"
            if student["roll"] % 11 == 0
            else "excused"
            if student["roll"] % 17 == 0
            else "present"
        )
        main_note = (
            "No check-in was recorded before the register was locked."
            if main_status == "no_show"
            else "Checked in after the opening welcome."
            if main_status == "late"
            else "The event coordinator recorded an approved exception."
            if main_status == "excused"
            else "Checked in at the amphitheatre entrance."
        )
        attendance_id = deterministic_id(f"campus-event-attendance-annual-main-{student['key']}")
        marked_at = scheduled_timestamp(annual_day, 20, 35)
        marker = staff_by_key["kavita"]["user_id"]
        checked_in_at = (
            scheduled_timestamp(annual_day, 16, 50)
            if main_status == "late"
            else scheduled_timestamp(annual_day, 16, 15)
            if main_status == "present"
            else None
        )
        dataset["campus_event_attendance"].append((
            attendance_id, school_id, annual_id, annual_main_id, student["student_id"], main_status,
            main_note, checked_in_at, None, 1, marker, marked_at, marked_at,
        ))
        dataset["campus_event_attendance_revisions"].append((
            school_id, annual_id, annual_main_id, student["student_id"], attendance_id, None, main_status,
            None, main_note, None, checked_in_at, None, None, "Initial event register entry.", 1, marker,
            deterministic_id(f"campus-event-attendance-request-annual-main-{student['key']}"), marked_at,
        ))
        annual_attendance_count += 1

        if student["class_key"] != "7a" or student["roll"] > 15:
            continue
        rehearsal_status = "late" if student["roll"] % 9 == 0 else "present"
        rehearsal_note = "Joined after the first stage call." if rehearsal_status == "late" else "Performer check-in completed."
        rehearsal_attendance_id = deterministic_id(f"campus-event-attendance-annual-rehearsal-{student['key']}")
        rehearsal_marked_at = scheduled_timestamp(annual_rehearsal_day, 17, 35)
        rehearsal_checked_in_at = scheduled_timestamp(
            annual_rehearsal_day, 15, 20 if rehearsal_status == "late" else 0,
        )
        dataset["campus_event_session_selected_students"].append((
            school_id, annual_id, annual_rehearsal_id, student["student_id"],
        ))
        dataset["campus_event_session_participants"].append((
            school_id, annual_id, annual_rehearsal_id, student["student_id"], "mandatory",
        ))
        dataset["campus_event_attendance"].append((
            rehearsal_attendance_id, school_id, annual_id, annual_rehearsal_id, student["student_id"], rehearsal_status,
            rehearsal_note, rehearsal_checked_in_at, None, 1, marker, rehearsal_marked_at, rehearsal_marked_at,
        ))
        dataset["campus_event_attendance_revisions"].append((
            school_id, annual_id, annual_rehearsal_id, student["student_id"], rehearsal_attendance_id, None,
            rehearsal_status, None, rehearsal_note, None, rehearsal_checked_in_at, None, None,
            "Initial event register entry.", 1, marker,
            deterministic_id(f"campus-event-attendance-request-annual-rehearsal-{student['key']}"), rehearsal_marked_at,
        ))
        annual_rehearsal_count += 1

    picnic_students = [student for student in students if student["class_key"] == "7a"]
    picnic_checklist = [
        ("House T-shirt and student identity card", True),
        ("Labelled water bottle", True),
        ("Packed lunch and two snacks", True),
        ("Cap and light rain jacket", True),
    ]
    checklist_ids: list[str] = []
    for sort_order, (label, required) in enumerate(picnic_checklist, start=1):
        item_id = deterministic_id(f"campus-event-class-7a-picnic-checklist-{sort_order}")
        checklist_ids.append(item_id)
        dataset["campus_event_checklist_items"].append((item_id, school_id, picnic_id, label, required, sort_order))

    granted_consents = 0
    checklist_completions = 0
    for student in picnic_students:
        guardian = guardian_by_student[student["student_id"]]
        if student["key"] in {"aarav", "ananya"}:
            rsvp_status = "accepted"
        elif student["key"] == "rohan":
            rsvp_status = "pending"
        elif student["key"] == "kavya":
            rsvp_status = "declined"
        elif student["roll"] <= 18:
            rsvp_status = "accepted"
        elif student["roll"] <= 23:
            rsvp_status = "pending"
        else:
            rsvp_status = "declined"
        rsvp_by = guardian["user_id"] if rsvp_status != "pending" else None
        rsvp_at = scheduled_timestamp(picnic_day - timedelta(days=11), 19, student["roll"] % 50) if rsvp_by else None
        fee_invoice_id = deterministic_id(f"campus-event-class-7a-picnic-invoice-{student['key']}") if rsvp_status == "accepted" else None
        fee_is_paid = rsvp_status == "accepted" and (student["key"] == "aarav" or student["roll"] % 2 == 0)
        if fee_invoice_id:
            fee_reference = f"EVT-PICNIC-7A-{student['roll']:02d}"
            dataset["campus_event_fee_invoices"].append((
                fee_invoice_id, school_id, student["student_id"], fee_reference,
                "Class 7A Discovery Picnic - Bannerghatta", 185000, picnic_day - timedelta(days=7),
                principal_id, picnic_published,
            ))
            if fee_is_paid:
                dataset["campus_event_fee_payments"].append((
                    deterministic_id(f"campus-event-class-7a-picnic-payment-{student['key']}"), school_id,
                    fee_invoice_id, 185000, "bank_transfer", f"{fee_reference}-PAID",
                    deterministic_id(f"campus-event-class-7a-picnic-payment-command-{student['key']}"),
                    principal_id, scheduled_timestamp(picnic_day - timedelta(days=6), 10, student["roll"] % 50),
                ))
        dataset["campus_event_participants"].append((
            school_id, picnic_id, student["student_id"], "optional", rsvp_status, fee_invoice_id,
            picnic_published, rsvp_by, rsvp_at,
        ))
        # Optional event invitations are broader than the operational session roster.
        # Only an explicit acceptance makes this student expected for attendance.
        if rsvp_status == "accepted":
            for session_id in (picnic_departure_id, picnic_activity_id, picnic_return_id):
                dataset["campus_event_session_participants"].append((
                    school_id, picnic_id, session_id, student["student_id"], "optional",
                ))

        authority_id = deterministic_id(f"campus-event-consent-authority-{student['key']}")
        dataset["campus_event_consent_authorities"].append((
            authority_id, school_id, guardian["relationship_id"], "active", date(start_year, 4, 1), None,
            "enrollment", "Primary guardian relationship verified for school event consent.", 1,
            principal_id, picnic_created, None, None, None,
        ))

        consent_status: str | None
        if student["key"] in {"aarav", "ananya"} or (rsvp_status == "accepted" and student["roll"] <= 14):
            consent_status = "granted"
        elif rsvp_status == "declined":
            consent_status = "denied"
        else:
            consent_status = None
        if consent_status is None:
            continue

        consent_at = scheduled_timestamp(picnic_day - timedelta(days=10), 20, student["roll"] % 50)
        consent_note = (
            "Approved for the supervised Class 7A excursion."
            if consent_status == "granted"
            else "Family is unavailable for the excursion date."
        )
        dataset["campus_event_consents"].append((
            school_id, picnic_id, student["student_id"], guardian["relationship_id"], authority_id,
            consent_status, consent_note, guardian["user_id"], consent_at, 1,
        ))
        if consent_status != "granted" or rsvp_status != "accepted":
            continue
        granted_consents += 1
        completed_item_count = len(checklist_ids) if student["key"] == "aarav" else 3 if student["roll"] % 2 == 0 else 2
        for item_id in checklist_ids[:completed_item_count]:
            dataset["campus_event_checklist_completions"].append((
                school_id, picnic_id, item_id, student["student_id"], guardian["user_id"],
                scheduled_timestamp(picnic_day - timedelta(days=4), 18, student["roll"] % 50),
            ))
            checklist_completions += 1

    for student in picnic_students:
        dataset["campus_event_participants"].append((
            school_id, class_test_id, student["student_id"], "mandatory", "pending", None,
            class_test_published, None, None,
        ))
        dataset["campus_event_session_participants"].append((
            school_id, class_test_id, class_test_session_id, student["student_id"], "mandatory",
        ))

    return {
        "campus_events": 3,
        "campus_event_sessions": 6,
        "campus_event_participants": len(students) + len(picnic_students) * 2,
        "campus_event_attendance_records": annual_attendance_count + annual_rehearsal_count,
        "picnic_participants": len(picnic_students),
        "picnic_granted_consents": granted_consents,
        "picnic_checklist_completions": checklist_completions,
        "picnic_fee_invoices": len(dataset["campus_event_fee_invoices"]),
        "picnic_fee_payments": len(dataset["campus_event_fee_payments"]),
        "campus_event_session_participants": len(dataset["campus_event_session_participants"]),
    }


def build_dataset(as_of: date, seed: int, demo_password: str) -> tuple[dict[str, list[tuple[Any, ...]]], dict[str, Any]]:
    rng = random.Random(seed)
    academic_year, term_start, term_end = academic_year_for(as_of)
    term_id = deterministic_id("term-2026")
    school_id = deterministic_id(SCHOOL_KEY)
    students = make_students(rng, academic_year)
    guardians = make_guardians(students, rng)
    days = attendance_days(as_of)

    staff: list[dict[str, Any]] = []
    for key, username, first, last, subject_key, designation in TEACHERS:
        legacy_key = {"arjun": "user-arjun-teacher", "priya": "user-priya-teacher"}.get(key, f"user-{key}")
        staff.append({
            "key": key,
            "user_id": deterministic_id(legacy_key),
            "username": username,
            "first": first,
            "last": last,
            "email": f"{first.lower()}.{last.lower()}@cambridge.example.test" if key != "kavita" else "kavita.mehta@example.test",
            "subject_key": subject_key,
            "designation": designation,
        })
    coordinator = {
        "key": "sunita", "user_id": deterministic_id("user-sunita-attendance"), "username": "sunita.attendance",
        "first": "Sunita", "last": "Deshmukh", "email": "sunita.deshmukh@cambridge.example.test",
        "subject_key": None, "designation": "Attendance & Student Welfare Coordinator",
    }
    staff.append(coordinator)
    principal = {
        "user_id": deterministic_id("user-meera-principal"), "username": "meera.principal", "first": "Meera", "last": "Kapoor",
        "email": "meera.kapoor@example.test",
    }
    shared_hash = password_hash(demo_password, rng)

    dataset: dict[str, list[tuple[Any, ...]]] = {name: [] for name in [
        "schools", "calendar_days", "users", "memberships", "students", "parents", "guardians", "terms", "sections", "enrollments",
        "subjects", "subject_attendance", "attendance", "gate_events", "timetable", "policies", "leaves", "leave_audits",
        "diary", "diary_acknowledgements", "diary_notes", "notifications", "contacts",
        "campus_events", "campus_event_class_sections", "campus_event_selected_students", "campus_event_staff",
        "campus_event_sessions", "campus_event_participants", "campus_event_consent_authorities",
        "campus_event_consents", "campus_event_checklist_items", "campus_event_checklist_completions",
        "campus_event_attendance", "campus_event_attendance_revisions", "class_staff_assignments",
        "campus_event_session_selected_students", "campus_event_session_participants",
        "campus_event_fee_invoices", "campus_event_fee_payments",
    ]}
    dataset["schools"].append((school_id, SCHOOL_NAME, SCHOOL_CODE))
    dataset["calendar_days"].append((deterministic_id("calendar-gandhi-jayanti"), school_id, date(int(academic_year[:4]), 10, 2), False, "Gandhi Jayanti", "public_holiday"))

    def add_user(user_id: str, username: str, email: str, first: str, last: str, role: str, membership_role: str) -> None:
        dataset["users"].append((user_id, username, email, shared_hash, first, last, role, True, PROFILE_AVATARS.get(username, "")))
        dataset["memberships"].append((deterministic_id(f"membership-{user_id}"), user_id, school_id, membership_role, True))

    for student in students:
        add_user(student["user_id"], student["username"], student["email"], student["first"], student["last"], "student", "student")
        dataset["students"].append((
            student["student_id"], student["user_id"], school_id, student["admission"], student["birth"], student["blood_group"],
            student["phone"], student["avatar"],
        ))
    added_guardian_users: set[str] = set()
    added_parent_ids: set[str] = set()
    for guardian in guardians:
        if guardian["user_id"] not in added_guardian_users:
            add_user(guardian["user_id"], guardian["username"], guardian["email"], guardian["first"], guardian["last"], "parent", "guardian")
            added_guardian_users.add(guardian["user_id"])
        if guardian["parent_id"] not in added_parent_ids:
            dataset["parents"].append((guardian["parent_id"], guardian["user_id"], guardian["phone"]))
            added_parent_ids.add(guardian["parent_id"])
        dataset["guardians"].append((
            guardian["relationship_id"], guardian["parent_id"], guardian["student_id"], guardian["relationship"], True, True,
        ))
    for teacher in staff:
        add_user(teacher["user_id"], teacher["username"], teacher["email"], teacher["first"], teacher["last"], "staff", "staff")
    add_user(principal["user_id"], principal["username"], principal["email"], principal["first"], principal["last"], "admin", "admin")

    dataset["terms"].append((term_id, school_id, academic_year, "Term 1", term_start, term_end, 85, True))
    room_by_class = {"6a": "201", "6b": "202", "7a": "204", "7b": "205", "8a": "301", "8b": "302", "9a": "401", "9b": "402"}
    class_ids = {key: deterministic_id(f"class-{key}") for key in room_by_class}
    for class_key, room in room_by_class.items():
        dataset["sections"].append((class_ids[class_key], school_id, academic_year, class_key[0], class_key[1].upper(), "CBSE", room))
    for student in students:
        dataset["enrollments"].append((student["enrollment_id"], student["student_id"], class_ids[student["class_key"]], term_id, student["roll"], True))

    subject_ids = {subject[0]: deterministic_id(f"subject-{subject[0]}") for subject in SUBJECTS}
    for key, code, name, short_name, color, icon in SUBJECTS:
        dataset["subjects"].append((subject_ids[key], school_id, code, name, short_name, color, icon))
    dataset["policies"].append((
        deterministic_id("attendance-policy"), term_id, "CBSE Term Attendance Policy", 85, 2,
        "Students must maintain at least 85% attendance. Medical leave longer than two consecutive school days requires supporting documentation.",
    ))

    teacher_by_subject: dict[str, list[dict[str, Any]]] = {}
    for teacher in staff:
        if teacher["subject_key"]:
            teacher_by_subject.setdefault(teacher["subject_key"], []).append(teacher)
    homeroom_teacher = {class_key: staff[index % len(TEACHERS)] for index, class_key in enumerate(room_by_class)}

    period_times = [
        (1, "09:00", "09:45"), (2, "09:50", "10:35"), (3, "10:40", "11:25"),
        (4, "11:30", "12:05"), (5, "12:15", "13:00"), (6, "13:05", "13:50"),
    ]
    subject_keys = [subject[0] for subject in SUBJECTS]
    timetable_lookup: dict[tuple[str, int], list[tuple[int, str]]] = {}
    for class_index, (class_key, room) in enumerate(room_by_class.items()):
        timetable_lookup.update({(class_key, weekday): [] for weekday in range(1, 7)})
        for weekday in range(1, 7):
            slots = period_times if weekday <= 5 else period_times[:3]
            for period, starts_at, ends_at in slots:
                if period == 4:
                    dataset["timetable"].append((
                        deterministic_id(f"slot-{class_key}-{weekday}-{period}"), class_ids[class_key], term_id, None, weekday, period,
                        starts_at, ends_at, "break", "Lunch Break", "", None, "",
                    ))
                    continue
                subject_index = (class_index + (period - 1) + (weekday - 1) * 2) % len(subject_keys)
                subject_key = subject_keys[subject_index]
                teacher_options = teacher_by_subject[subject_key]
                teacher = teacher_options[0 if int(class_key[0]) <= 7 else 1]
                timetable_lookup[(class_key, weekday)].append((period, subject_key))
                dataset["timetable"].append((
                    deterministic_id(f"slot-{class_key}-{weekday}-{period}"), class_ids[class_key], term_id, subject_ids[subject_key],
                    weekday, period, starts_at, ends_at, "class", "", f"Room {room}", teacher["user_id"], teacher["designation"],
                ))

    assignment_created_at = scheduled_timestamp(term_start, 9, 0)
    for class_key, teacher in homeroom_teacher.items():
        dataset["class_staff_assignments"].append((
            deterministic_id(f"class-staff-assignment-{class_key}-class-teacher-{teacher['key']}"),
            school_id, class_ids[class_key], teacher["user_id"], "class_teacher", None,
            term_start, term_end, principal["user_id"], assignment_created_at,
        ))
    subject_assignments = {
        (row[1], row[11], row[3])
        for row in dataset["timetable"]
        if row[8] == "class"
    }
    for class_id, teacher_id, subject_id in sorted(subject_assignments):
        dataset["class_staff_assignments"].append((
            deterministic_id(f"class-staff-assignment-{class_id}-{teacher_id}-{subject_id}"),
            school_id, class_id, teacher_id, "subject_teacher", subject_id,
            term_start, term_end, principal["user_id"], assignment_created_at,
        ))

    attendance_by_student: dict[str, dict[date, str]] = {}
    for student_index, student in enumerate(students):
        student_rng = random.Random(seed * 10_000 + student_index)
        statuses: dict[date, str] = {}
        marker = homeroom_teacher[student["class_key"]]["user_id"]
        for day_index, school_day in enumerate(days):
            status = status_for(student, day_index, len(days), student_rng)
            statuses[school_day] = status
            if status == "late":
                check_in = local_timestamp(school_day, 8, student_rng.randint(47, 58))
                check_out = local_timestamp(school_day, 14, student_rng.randint(43, 55))
                remarks = student_rng.choice(["School transport delayed.", "Reported at the attendance desk.", "Delayed by traffic congestion."])
            elif status in {"present", "half_day"}:
                check_in = local_timestamp(school_day, 8, student_rng.randint(19, 39))
                check_out = local_timestamp(school_day, 12 if status == "half_day" else 14, student_rng.randint(15, 55))
                remarks = "Left after lunch with guardian approval." if status == "half_day" else ""
            else:
                check_in = check_out = None
                remarks = "Approved medical leave." if status == "excused" else "Guardian notified through the school office."
            dataset["attendance"].append((
                deterministic_id(f"attendance-{student['key']}-{school_day.isoformat()}"), student["student_id"], class_ids[student["class_key"]],
                school_day, status, check_in, check_out, remarks, marker,
            ))
        attendance_by_student[student["student_id"]] = statuses

        recent_gate_days = days[-10:]
        for gate_day in recent_gate_days:
            status = statuses[gate_day]
            if status in {"absent", "excused"}:
                continue
            attendance_row = next(row for row in reversed(dataset["attendance"]) if row[1] == student["student_id"] and row[3] == gate_day)
            in_time, out_time = attendance_row[5], attendance_row[6]
            dataset["gate_events"].append((
                deterministic_id(f"gate-in-{student['key']}-{gate_day.isoformat()}"), student["student_id"], in_time, "in", "North Gate",
                "rfid", f"CIS-RFID-{student['admission'][-4:]}",
            ))
            if out_time:
                dataset["gate_events"].append((
                    deterministic_id(f"gate-out-{student['key']}-{gate_day.isoformat()}"), student["student_id"], out_time, "out", "North Gate",
                    "rfid", f"CIS-RFID-{student['admission'][-4:]}",
                ))

    for student in students:
        statuses = attendance_by_student[student["student_id"]]
        held = {key: 0 for key in subject_keys}
        attended = {key: 0 for key in subject_keys}
        excused = {key: 0 for key in subject_keys}
        for school_day, status in statuses.items():
            scheduled = timetable_lookup[(student["class_key"], school_day.isoweekday())]
            for period, subject_key in scheduled:
                held[subject_key] += 1
                if status in {"present", "late"} or (status == "half_day" and period < 4):
                    attended[subject_key] += 1
                elif status == "excused":
                    excused[subject_key] += 1
        for subject_key in subject_keys:
            dataset["subject_attendance"].append((
                deterministic_id(f"subject-attendance-{student['key']}-{subject_key}"), student["student_id"], subject_ids[subject_key], term_id,
                held[subject_key], attended[subject_key], excused[subject_key],
            ))

    guardian_by_student = {guardian["student_id"]: guardian for guardian in guardians}
    approved_candidates = [student for student in students if any(status == "excused" for status in attendance_by_student[student["student_id"]].values())]
    for index, student in enumerate(approved_candidates[:48]):
        excused_day = next(day for day, status in attendance_by_student[student["student_id"]].items() if status == "excused")
        guardian = guardian_by_student[student["student_id"]]
        leave_id = deterministic_id(f"leave-approved-{student['key']}-{excused_day.isoformat()}")
        submitted = local_timestamp(excused_day - timedelta(days=2), 18, 10)
        authorized = local_timestamp(excused_day - timedelta(days=2), 19, 5)
        decided = local_timestamp(excused_day - timedelta(days=1), 10, 30)
        dataset["leaves"].append((
            leave_id, student["student_id"], term_id, guardian["user_id"], "medical", excused_day, excused_day,
            "Seasonal illness; rest was advised and the class teacher was informed.", "school_approved", submitted,
            guardian["user_id"], authorized, coordinator["user_id"], decided,
        ))
        for step, (action, previous, current, actor, at, note) in enumerate([
            ("submitted", "draft", "pending_guardian", guardian["user_id"], submitted, "Leave request submitted by the primary guardian."),
            ("authorized", "pending_guardian", "authorized", guardian["user_id"], authorized, "Guardian identity verified and request authorized."),
            ("approved", "authorized", "school_approved", coordinator["user_id"], decided, "Approved against the daily attendance register."),
        ]):
            dataset["leave_audits"].append((deterministic_id(f"leave-audit-{leave_id}-{step}"), leave_id, actor, action, previous, current, note, at))

    future_school_day = as_of + timedelta(days=3)
    while future_school_day.weekday() == 6:
        future_school_day += timedelta(days=1)
    active_students = [student for student in students if student["key"] == "aarav"] + [student for student in students if student["key"] != "aarav"][:11]
    for index, student in enumerate(active_students):
        guardian = guardian_by_student[student["student_id"]]
        leave_id = deterministic_id("leave-pending") if student["key"] == "aarav" else deterministic_id(f"leave-future-{student['key']}")
        status = "pending_guardian" if index % 2 == 0 else "authorized"
        requested_by = student["user_id"] if status == "pending_guardian" else guardian["user_id"]
        submitted = local_timestamp(as_of, 16, 15 + index)
        authorized_by = guardian["user_id"] if status == "authorized" else None
        authorized_at = local_timestamp(as_of, 17, 10 + index) if status == "authorized" else None
        dataset["leaves"].append((
            leave_id, student["student_id"], term_id, requested_by, "medical" if index % 3 == 0 else "family",
            future_school_day + timedelta(days=index % 4), future_school_day + timedelta(days=index % 4),
            "Medical appointment and recovery time." if index % 3 == 0 else "A close family commitment requires one day of leave.",
            status, submitted, authorized_by, authorized_at, None, None,
        ))
        dataset["leave_audits"].append((
            deterministic_id(f"leave-audit-{leave_id}-submitted"), leave_id, requested_by, "submitted", "draft",
            "authorized" if status == "authorized" else "pending_guardian", "Leave request submitted through the family portal.", submitted,
        ))
        if status == "authorized":
            dataset["leave_audits"].append((
                deterministic_id(f"leave-audit-{leave_id}-authorized"), leave_id, guardian["user_id"], "authorized", "pending_guardian", "authorized",
                "Primary guardian authorization recorded.", authorized_at,
            ))
        recipient = guardian["user_id"] if status == "pending_guardian" else coordinator["user_id"]
        dataset["notifications"].append((
            deterministic_id(f"notification-{leave_id}"), recipient, "leave",
            "Leave authorization required" if status == "pending_guardian" else "Leave ready for school review",
            f"{student['first']} {student['last']} has a leave request awaiting action.",
            f"/parent/leave?leave_id={leave_id}" if status == "pending_guardian" else "/teacher/attendance",
            {"leave_request_id": leave_id, "student_id": student["student_id"]}, None, local_timestamp(as_of, 17, 30),
        ))

    diary_templates = [
        ("homework", "mat", "Practice set", "Complete the assigned practice questions and show each calculation step.", True),
        ("homework", "eng", "Guided reading", "Read the assigned passage and note five new words with their meanings.", True),
        ("note", "sci", "Lab readiness", "Bring the lab manual, observation notebook, and the signed safety checklist.", True),
        ("announcement", None, "House activity update", "House activity selections will be held after lunch. Carry the regular school diary.", False),
        ("schedule", "ped", "Sports kit reminder", "Wear the house sports uniform and carry a labelled water bottle.", True),
    ]
    student_by_class: dict[str, list[dict[str, Any]]] = {}
    for student in students:
        student_by_class.setdefault(student["class_key"], []).append(student)
    for class_index, class_key in enumerate(room_by_class):
        for item_index, (item_type, subject_key, title, body, acknowledgement) in enumerate(diary_templates):
            diary_day = as_of + timedelta(days=(item_index % 3) - 1)
            author = homeroom_teacher[class_key] if subject_key is None else teacher_by_subject[subject_key][0 if int(class_key[0]) <= 7 else 1]
            item_id = deterministic_id(f"diary-{class_key}-{item_index}-{diary_day.isoformat()}")
            due_at = local_timestamp(diary_day + timedelta(days=2), 17, 0) if item_type == "homework" else None
            dataset["diary"].append((
                item_id, school_id, class_ids[class_key], term_id, diary_day, item_type,
                subject_ids[subject_key] if subject_key else None, f"{title} · Class {class_key.upper()}", body,
                author["user_id"], due_at, acknowledgement, local_timestamp(as_of - timedelta(days=1), 16, 0),
            ))
            if acknowledgement:
                for student in student_by_class[class_key]:
                    if (student["roll"] + item_index + class_index) % 4:
                        guardian = guardian_by_student[student["student_id"]]
                        dataset["diary_acknowledgements"].append((
                            deterministic_id(f"diary-ack-{item_id}-{student['student_id']}"), item_id, student["student_id"], guardian["user_id"],
                            local_timestamp(as_of, 7, 30 + student["roll"] % 20),
                        ))
        featured = student_by_class[class_key][(class_index * 3) % 25]
        first_diary_id = deterministic_id(f"diary-{class_key}-0-{(as_of - timedelta(days=1)).isoformat()}")
        dataset["diary_notes"].append((
            deterministic_id(f"diary-note-{class_key}"), first_diary_id, featured["student_id"], guardian_by_student[featured["student_id"]]["user_id"],
            "The assignment has been noted. Please let us know if any additional worksheet is required.", local_timestamp(as_of, 8, 5),
        ))

    for student in students:
        statuses = attendance_by_student[student["student_id"]]
        points = sum(1 if status in {"present", "late"} else 0.5 if status == "half_day" else 0 for status in statuses.values())
        percentage = round(points * 100 / len(statuses), 2)
        if percentage < 85:
            guardian = guardian_by_student[student["student_id"]]
            dataset["notifications"].append((
                deterministic_id(f"notification-attendance-{student['key']}"), guardian["user_id"], "attendance", "Attendance attention needed",
                f"{student['first']}'s attendance is {percentage:.1f}%, below the 85% term requirement.", "/parent/attendance",
                {"student_id": student["student_id"], "percentage": percentage}, None, local_timestamp(as_of, 15, 45),
            ))
    for student in students[:32]:
        dataset["notifications"].append((
            deterministic_id(f"notification-diary-{student['key']}"), student["user_id"], "diary", "New diary items published",
            "Your teachers published homework and reminders for today.", "/student/diary",
            {"student_id": student["student_id"]}, None if student["roll"] % 3 == 0 else local_timestamp(as_of, 16, 30),
            local_timestamp(as_of, 16, 0),
        ))

    dataset["contacts"].extend([
        (deterministic_id("contact-homeroom"), school_id, "Class 7A Homeroom Advisor", "Ms. Kavita Mehta", "+91 80 4567 1200", "kavita.mehta@cambridge.example.test", "Weekdays, 3:30–4:30 PM", 1),
        (deterministic_id("contact-attendance"), school_id, "Attendance Office", "Ms. Sunita Deshmukh", "+91 80 4567 1104", "attendance@cambridge.example.test", "Weekdays, 8:00 AM–4:30 PM", 2),
        (deterministic_id("contact-office"), school_id, "School Office", "Student Services", "+91 80 4567 1000", "office@cambridge.example.test", "Weekdays, 8:00 AM–5:00 PM", 3),
    ])

    campus_event_summary = add_campus_event_fixtures(
        dataset, students, guardians, staff, principal, class_ids, subject_ids, school_id, academic_year,
    )
    validate_dataset(dataset, students, guardians, staff, class_ids, days)
    summary = {
        "school": SCHOOL_NAME,
        "as_of": as_of.isoformat(),
        "academic_year": academic_year,
        "students": len(students),
        "parents": len({guardian["parent_id"] for guardian in guardians}),
        "teachers_and_staff": len(staff),
        "principals": 1,
        "class_sections": len(class_ids),
        "school_days": len(days),
        "attendance_records": len(dataset["attendance"]),
        "subject_attendance_rows": len(dataset["subject_attendance"]),
        "timetable_slots": len(dataset["timetable"]),
        "class_staff_assignments": len(dataset["class_staff_assignments"]),
        "gate_events": len(dataset["gate_events"]),
        "leave_requests": len(dataset["leaves"]),
        "diary_items": len(dataset["diary"]),
        "notifications": len(dataset["notifications"]),
        **campus_event_summary,
        "relationship_invariants": {
            "students_without_guardian": 0,
            "students_without_enrollment": 0,
            "students_without_attendance_history": 0,
            "class_slots_without_teacher": 0,
        },
        "demo_accounts": {
            "student": "aarav.student",
            "parent": "pooja.parent",
            "teacher": "kavita.staff",
            "principal": "meera.principal",
        },
    }
    return dataset, summary


def validate_dataset(
    dataset: dict[str, list[tuple[Any, ...]]],
    students: Sequence[dict[str, Any]],
    guardians: Sequence[dict[str, Any]],
    staff: Sequence[dict[str, Any]],
    class_ids: dict[str, str],
    days: Sequence[date],
) -> None:
    student_ids = {student["student_id"] for student in students}
    guardian_student_ids = {guardian["student_id"] for guardian in guardians}
    enrollment_student_ids = {row[1] for row in dataset["enrollments"]}
    attendance_student_ids = {row[1] for row in dataset["attendance"]}
    active_staff_ids = {teacher["user_id"] for teacher in staff}
    if len(students) != 200 or len(student_ids) != 200:
        raise ValueError("The medium-school fixture must contain exactly 200 unique students.")
    if guardian_student_ids != student_ids:
        raise ValueError("Every student must have exactly one generated primary guardian.")
    if enrollment_student_ids != student_ids or len(dataset["enrollments"]) != len(students):
        raise ValueError("Every student must have exactly one active term enrollment.")
    if attendance_student_ids != student_ids or len(dataset["attendance"]) != len(students) * len(days):
        raise ValueError("Every student must have a complete attendance row for every generated school day.")
    if any(row[8] not in active_staff_ids for row in dataset["attendance"]):
        raise ValueError("Every attendance row must be marked by active school staff.")
    if len(dataset["subject_attendance"]) != len(students) * len(SUBJECTS):
        raise ValueError("Every student must have subject attendance for every subject.")
    if any(row[9] == "class" and row[11] not in active_staff_ids for row in dataset["timetable"]):
        raise ValueError("Every class timetable slot must resolve to active teaching staff.")
    if {row[1] for row in dataset["timetable"]} != set(class_ids.values()):
        raise ValueError("Every class section must have a published timetable.")
    occupied_teachers: set[tuple[int, str, str]] = set()
    occupied_rooms: set[tuple[int, str, str]] = set()
    for row in dataset["timetable"]:
        weekday, starts_at, slot_type, room, teacher_id = row[4], row[6], row[8], row[10], row[11]
        if slot_type != "class":
            continue
        teacher_key = (weekday, starts_at, teacher_id)
        room_key = (weekday, starts_at, room)
        if teacher_key in occupied_teachers or room_key in occupied_rooms:
            raise ValueError("Generated timetable contains a teacher or room collision.")
        occupied_teachers.add(teacher_key)
        occupied_rooms.add(room_key)

    annual_id = deterministic_id("campus-event-annual-function-2026")
    picnic_id = deterministic_id("campus-event-class-7a-picnic-2026")
    class_test_id = deterministic_id("campus-event-class-7a-mathematics-test-2026")
    event_ids = {row[0] for row in dataset["campus_events"]}
    if event_ids != {annual_id, picnic_id, class_test_id}:
        raise ValueError("The event fixture must contain the Annual Function, Class 7A picnic and Mathematics test.")
    events_by_id = {row[0]: row for row in dataset["campus_events"]}
    if events_by_id[annual_id][3] != "completed" or any(events_by_id[event_id][3] != "published" for event_id in (picnic_id, class_test_id)):
        raise ValueError("The Annual Function must be completed and the picnic and class test must be published.")
    if any(row[14] != "none" for row in dataset["campus_events"]):
        raise ValueError("Campus event attendance must not contribute to academic attendance.")
    if events_by_id[annual_id][10:14] != ("mandatory", False, False, False):
        raise ValueError("The Annual Function must be mandatory, free and require neither RSVP nor guardian consent.")
    if events_by_id[picnic_id][10:14] != ("optional", True, True, True):
        raise ValueError("The optional picnic must independently require RSVP, guardian consent and payment.")
    if events_by_id[class_test_id][10:14] != ("mandatory", False, False, False):
        raise ValueError("The Mathematics class test must be mandatory, free and need no guardian consent.")
    if events_by_id[class_test_id][-1] != deterministic_id("subject-mat"):
        raise ValueError("The class test must be explicitly linked to Mathematics.")
    if events_by_id[annual_id][-4:-1] != (None, None, "INR") or events_by_id[class_test_id][-4:-1] != (None, None, "INR"):
        raise ValueError("Free events must not fabricate a payment amount or due date.")
    if events_by_id[picnic_id][-4:-1] != (185000, date(2026, 10, 3).isoformat(), "INR"):
        raise ValueError("The paid picnic must define its INR fee and due date at event level.")

    participant_rows = dataset["campus_event_participants"]
    annual_participants = {row[2] for row in participant_rows if row[1] == annual_id}
    picnic_participants = {row[2] for row in participant_rows if row[1] == picnic_id}
    class_test_participants = {row[2] for row in participant_rows if row[1] == class_test_id}
    class_7a_students = {student["student_id"] for student in students if student["class_key"] == "7a"}
    if annual_participants != student_ids:
        raise ValueError("The school-wide Annual Function must invite every generated student.")
    if picnic_participants != class_7a_students or class_test_participants != class_7a_students:
        raise ValueError("The Class 7A picnic and Mathematics test rosters must match active Class 7A students.")
    if any((row[7] is None) != (row[8] is None) for row in participant_rows):
        raise ValueError("An RSVP actor and time must either both be recorded or both remain unknown.")
    expected_requirement = {annual_id: "mandatory", picnic_id: "optional", class_test_id: "mandatory"}
    if any(row[3] != expected_requirement[row[1]] for row in participant_rows):
        raise ValueError("Participant requirements must agree with their event policy.")

    invoices_by_id = {row[0]: row for row in dataset["campus_event_fee_invoices"]}
    payments_by_invoice: dict[str, int] = {}
    for payment in dataset["campus_event_fee_payments"]:
        payments_by_invoice[payment[2]] = payments_by_invoice.get(payment[2], 0) + payment[3]
    for participant in participant_rows:
        _, event_id, student_id, _, rsvp_status, fee_invoice_id, *_ = participant
        if event_id == picnic_id and rsvp_status == "accepted":
            if fee_invoice_id is None or fee_invoice_id not in invoices_by_id:
                raise ValueError("Every accepted paid-picnic RSVP must link to a real fee invoice.")
            invoice = invoices_by_id[fee_invoice_id]
            if invoice[2] != student_id or invoice[5] != 185000:
                raise ValueError("Picnic fee invoice must belong to the participant for the configured amount.")
            paid = payments_by_invoice.get(fee_invoice_id, 0)
            if paid not in {0, invoice[5]}:
                raise ValueError("Picnic fee fixture must be either pending or fully paid.")
        elif fee_invoice_id is not None:
            raise ValueError("Only an accepted paid-picnic participant may have an event fee invoice.")
    paid_invoice_ids = {invoice_id for invoice_id, paid in payments_by_invoice.items() if paid == invoices_by_id[invoice_id][5]}
    pending_invoice_ids = set(invoices_by_id) - paid_invoice_ids
    if not paid_invoice_ids or not pending_invoice_ids:
        raise ValueError("The picnic fixture must include both paid and pending fee obligations.")

    guardian_relationship_by_student = {guardian["student_id"]: guardian["relationship_id"] for guardian in guardians}
    active_authority_by_relationship = {
        row[2]: row[0] for row in dataset["campus_event_consent_authorities"] if row[3] == "active"
    }
    if {
        relationship_id for student_id, relationship_id in guardian_relationship_by_student.items()
        if student_id in picnic_participants
    } != set(active_authority_by_relationship):
        raise ValueError("Every picnic participant must have one purpose-specific active consent authority.")
    for consent in dataset["campus_event_consents"]:
        _, event_id, student_id, relationship_id, authority_id, *_ = consent
        if event_id != picnic_id or student_id not in picnic_participants:
            raise ValueError("Event consent must belong to a picnic participant.")
        if guardian_relationship_by_student[student_id] != relationship_id:
            raise ValueError("Event consent relationship must belong to the same student.")
        if active_authority_by_relationship.get(relationship_id) != authority_id:
            raise ValueError("Event consent must use the student's active purpose-specific authority.")
    consent_by_student = {row[2]: row for row in dataset["campus_event_consents"] if row[1] == picnic_id}
    picnic_rows_by_student = {row[2]: row for row in participant_rows if row[1] == picnic_id}
    if not any(row[5] == "granted" for row in consent_by_student.values()) or not any(row[5] == "denied" for row in consent_by_student.values()):
        raise ValueError("The picnic fixture must include both granted and denied guardian decisions.")
    if not any(student_id not in consent_by_student for student_id in picnic_participants):
        raise ValueError("The picnic fixture must preserve pending consent as the absence of a decision.")
    if any(row[4] == "pending" and student_id in consent_by_student for student_id, row in picnic_rows_by_student.items()):
        raise ValueError("A pending RSVP must not fabricate a guardian consent decision.")

    sessions_by_id = {row[0]: row for row in dataset["campus_event_sessions"]}
    for session in sessions_by_id.values():
        event = events_by_id[session[2]]
        if not (event[7] <= session[6] < session[7] <= event[8]):
            raise ValueError("Every event session must fall inside its event window.")
        if session[2] == annual_id and session[9] != "locked":
            raise ValueError("Completed Annual Function registers must be locked.")
        if session[2] == picnic_id and session[9] != "open":
            raise ValueError("Upcoming picnic registers must remain open.")
        if session[2] == class_test_id and session[9] != "open":
            raise ValueError("Upcoming class-test register must remain open.")

    participant_lookup = {(row[1], row[2]): row for row in participant_rows}
    session_participant_lookup = {
        (row[1], row[2], row[3]): row for row in dataset["campus_event_session_participants"]
    }
    selected_rehearsal_students = {
        row[3] for row in dataset["campus_event_session_selected_students"]
        if row[1] == annual_id and row[2] == deterministic_id("campus-event-annual-function-rehearsal-2026")
    }
    rehearsal_roster = {
        row[3] for row in dataset["campus_event_session_participants"]
        if row[1] == annual_id and row[2] == deterministic_id("campus-event-annual-function-rehearsal-2026")
    }
    if selected_rehearsal_students != rehearsal_roster or len(rehearsal_roster) != 15:
        raise ValueError("The Annual Function rehearsal must have an explicit 15-student performer roster.")
    main_roster = {
        row[3] for row in dataset["campus_event_session_participants"]
        if row[1] == annual_id and row[2] == deterministic_id("campus-event-annual-function-main-2026")
    }
    if main_roster != student_ids:
        raise ValueError("The main mandatory Annual Function session must expect the complete school roster.")
    accepted_picnic_students = {
        row[2] for row in participant_rows
        if row[1] == picnic_id and row[4] == "accepted"
    }
    for session in sessions_by_id.values():
        if session[2] not in {picnic_id, class_test_id}:
            continue
        rows = [row for row in dataset["campus_event_session_participants"] if row[2] == session[0]]
        expected = "optional" if session[2] == picnic_id else "mandatory"
        expected_students = accepted_picnic_students if session[2] == picnic_id else class_7a_students
        if {row[3] for row in rows} != expected_students or any(row[4] != expected for row in rows):
            raise ValueError("Each upcoming Class 7A session must have the correct accepted or mandatory roster.")
    if any(
        participant_lookup[(row[1], row[3])][4] != "accepted"
        for row in dataset["campus_event_session_participants"]
        if row[4] == "optional"
    ):
        raise ValueError("Every optional session-roster participant must have an accepted RSVP.")
    attendance_ids: set[str] = set()
    for attendance in dataset["campus_event_attendance"]:
        attendance_id, _, event_id, session_id, student_id, status, *_ = attendance
        participant = participant_lookup.get((event_id, student_id))
        if (
            participant is None
            or session_id not in sessions_by_id
            or sessions_by_id[session_id][2] != event_id
            or (event_id, session_id, student_id) not in session_participant_lookup
        ):
            raise ValueError("Every event attendance record must resolve to its participant and session.")
        if participant[3] == "optional" and participant[4] != "accepted" and status == "no_show":
            raise ValueError("Only an accepted optional participant can be marked no-show.")
        if event_id != annual_id:
            raise ValueError("Future picnic and class-test sessions must not fabricate attendance observations.")
        checked_in_at, checked_out_at = attendance[7], attendance[8]
        if (status in {"present", "late"}) != (checked_in_at is not None) or checked_out_at is not None:
            raise ValueError("Seeded event attendance timestamps must match the recorded status and capture mode.")
        attendance_ids.add(attendance_id)
    if len(attendance_ids) != len(dataset["campus_event_attendance"]):
        raise ValueError("Event attendance identifiers must be unique.")
    revision_record_ids = {row[4] for row in dataset["campus_event_attendance_revisions"]}
    if revision_record_ids != attendance_ids or len(revision_record_ids) != len(dataset["campus_event_attendance_revisions"]):
        raise ValueError("Every seeded event attendance mark must have one append-only initial revision.")

    checklist_items = {row[0]: row for row in dataset["campus_event_checklist_items"]}
    if not checklist_items or any(not row[4] for row in checklist_items.values()):
        raise ValueError("Every picnic kit item must be explicitly required.")
    for completion in dataset["campus_event_checklist_completions"]:
        _, event_id, item_id, student_id, *_ = completion
        if event_id != picnic_id or student_id not in picnic_participants or checklist_items.get(item_id, (None, None, None))[2] != picnic_id:
            raise ValueError("Checklist completion must belong to the same picnic and participant.")
        if consent_by_student.get(student_id, (None,) * 6)[5] != "granted" or picnic_rows_by_student[student_id][4] != "accepted":
            raise ValueError("Kit completion is available only for an accepted, consented picnic participant.")
    completion_counts: dict[str, int] = {}
    for completion in dataset["campus_event_checklist_completions"]:
        completion_counts[completion[3]] = completion_counts.get(completion[3], 0) + 1
    if not any(count == len(checklist_items) for count in completion_counts.values()) or not any(count < len(checklist_items) for count in completion_counts.values()):
        raise ValueError("The picnic fixture must include both complete and incomplete kit checklists.")

    assignments = dataset["class_staff_assignments"]
    subject_assignment_keys = {
        (row[2], row[3], row[5]) for row in assignments if row[4] == "subject_teacher"
    }
    for timetable_row in dataset["timetable"]:
        if timetable_row[8] == "class" and (timetable_row[1], timetable_row[11], timetable_row[3]) not in subject_assignment_keys:
            raise ValueError("Every teaching timetable row must have a matching dated subject assignment.")
    homeroom_classes = {row[2] for row in assignments if row[4] == "class_teacher"}
    if homeroom_classes != set(class_ids.values()):
        raise ValueError("Every generated class must have one explicit class-teacher assignment.")

    kavita_id = deterministic_id("user-kavita")
    mathematics_id = deterministic_id("subject-mat")
    class_7a_id = class_ids["7a"]
    if (class_7a_id, kavita_id, mathematics_id) not in subject_assignment_keys:
        raise ValueError("Kavita Mehta must hold the dated Class 7A Mathematics assignment.")
    if (school_id := events_by_id[class_test_id][1]) != deterministic_id(SCHOOL_KEY):
        raise ValueError("The class test must belong to the generated school.")
    if (school_id, class_test_id, class_7a_id) not in set(dataset["campus_event_class_sections"]):
        raise ValueError("The Mathematics class test must be scoped to Class 7A.")
    if not any(
        row[1] == class_test_id and row[2] == kavita_id and row[3] == "organizer"
        for row in dataset["campus_event_staff"]
    ):
        raise ValueError("Kavita Mehta must organize the Class 7A Mathematics test.")
    class_test_start = datetime.fromisoformat(events_by_id[class_test_id][7])
    if not any(
        row[1] == class_7a_id and row[3] == mathematics_id and row[4] == class_test_start.isoweekday()
        and row[6] == class_test_start.strftime("%H:%M") and row[11] == kavita_id
        for row in dataset["timetable"]
    ):
        raise ValueError("The Class 7A Mathematics test must align with Kavita Mehta's timetable slot.")


def render_sql(dataset: dict[str, list[tuple[Any, ...]]], summary: dict[str, Any]) -> str:
    school_id = deterministic_id(SCHOOL_KEY)
    annual_event_id = deterministic_id("campus-event-annual-function-2026")
    picnic_event_id = deterministic_id("campus-event-class-7a-picnic-2026")
    class_test_event_id = deterministic_id("campus-event-class-7a-mathematics-test-2026")
    class_7a_id = deterministic_id("class-7a")
    annual_main_session_id = deterministic_id("campus-event-annual-function-main-2026")
    class_test_session_id = deterministic_id("campus-event-class-7a-mathematics-test-session-2026")
    principal_id = deterministic_id("user-meera-principal")
    statements = [
        "BEGIN;",
        "SET LOCAL statement_timeout = '120s';",
        f"SELECT pg_advisory_xact_lock(hashtext('omnischool:seed:{SCHOOL_CODE}'));",
        "CREATE TEMP TABLE omnischool_seed_student_ids (id uuid PRIMARY KEY) ON COMMIT DROP;",
        "CREATE TEMP TABLE omnischool_seed_days (day date PRIMARY KEY) ON COMMIT DROP;",
    ]
    statements += insert_sql("omnischool_seed_student_ids", ["id"], [(row[0],) for row in dataset["students"]])
    attendance_dates = sorted({row[3] for row in dataset["attendance"]})
    statements += insert_sql("omnischool_seed_days", ["day"], [(day,) for day in attendance_dates])
    statements += insert_sql(
        "schools", ["id", "name", "code"], dataset["schools"],
        conflict=" ON CONFLICT(id) DO UPDATE SET name=excluded.name,code=excluded.code",
    )
    statements += insert_sql(
        "school_calendar_days", ["id", "school_id", "date", "is_instructional", "label", "kind"], dataset["calendar_days"],
        conflict=" ON CONFLICT(school_id,date) DO UPDATE SET is_instructional=excluded.is_instructional,label=excluded.label,kind=excluded.kind,updated_at=now()",
    )
    statements += insert_sql(
        "users", ["id", "username", "email", "password_hash", "first_name", "last_name", "role", "is_active", "avatar_url"], dataset["users"],
        conflict=" ON CONFLICT(id) DO UPDATE SET username=excluded.username,email=excluded.email,password_hash=excluded.password_hash,first_name=excluded.first_name,last_name=excluded.last_name,role=excluded.role,is_active=excluded.is_active,avatar_url=excluded.avatar_url,updated_at=now()",
    )
    statements += insert_sql(
        "school_memberships", ["id", "user_id", "school_id", "role", "is_active"], dataset["memberships"],
        conflict=" ON CONFLICT(user_id,school_id,role) DO UPDATE SET is_active=excluded.is_active",
    )
    statements += insert_sql(
        "students", ["id", "user_id", "school_id", "admission_number", "date_of_birth", "blood_group", "emergency_contact", "avatar_url"], dataset["students"],
        conflict=" ON CONFLICT(id) DO UPDATE SET user_id=excluded.user_id,school_id=excluded.school_id,admission_number=excluded.admission_number,date_of_birth=excluded.date_of_birth,blood_group=excluded.blood_group,emergency_contact=excluded.emergency_contact,avatar_url=excluded.avatar_url",
    )
    statements += insert_sql(
        "parents", ["id", "user_id", "phone"], dataset["parents"],
        conflict=" ON CONFLICT(id) DO UPDATE SET user_id=excluded.user_id,phone=excluded.phone",
    )
    statements += insert_sql(
        "guardian_relationships", ["id", "guardian_id", "student_id", "relationship", "is_primary", "can_authorize_leave"], dataset["guardians"],
        conflict=" ON CONFLICT(guardian_id,student_id) DO UPDATE SET relationship=excluded.relationship,is_primary=excluded.is_primary,can_authorize_leave=CASE WHEN guardian_relationships.authority_source='reviewed' THEN guardian_relationships.can_authorize_leave ELSE excluded.can_authorize_leave END",
    )
    statements.append("""UPDATE school_people person SET avatar_url = CASE
      WHEN account.username='pooja.parent' THEN '/assets/pooja-sharma.png'
      WHEN account.username='parent.cis0103' THEN '/assets/rashmi-joshi.png'
      WHEN account.username='parent.cis0093' THEN '/assets/pooja-chauhan.png'
      WHEN EXISTS (SELECT 1 FROM guardian_relationships relationship JOIN students student ON student.id=relationship.student_id
        WHERE relationship.guardian_id=parent.id AND student.admission_number='CIS-2026-0201') THEN '/assets/nandita-deshmukh.png'
      ELSE person.avatar_url END
      FROM guardian_school_profiles profile JOIN parents parent ON parent.id=profile.guardian_id
      LEFT JOIN users account ON account.id=parent.user_id
      WHERE person.id=profile.person_id AND (account.username IN ('pooja.parent','parent.cis0103','parent.cis0093')
        OR EXISTS (SELECT 1 FROM guardian_relationships relationship JOIN students student ON student.id=relationship.student_id
          WHERE relationship.guardian_id=parent.id AND student.admission_number='CIS-2026-0201'));""")
    statements.append("""UPDATE school_people person SET avatar_url = (ARRAY[
      '/assets/pooja-sharma.png','/assets/rashmi-joshi.png','/assets/nandita-deshmukh.png','/assets/pooja-chauhan.png'
      ])[1 + (get_byte(decode(md5(person.id::text),'hex'),0) % 4)]
      FROM guardian_school_profiles profile WHERE person.id=profile.person_id AND person.avatar_url='';
      UPDATE users account SET avatar_url=person.avatar_url
      FROM parents parent JOIN guardian_school_profiles profile ON profile.guardian_id=parent.id
      JOIN school_people person ON person.id=profile.person_id
      WHERE account.id=parent.user_id AND account.avatar_url='' AND person.avatar_url<>'';""")
    statements += insert_sql(
        "academic_terms", ["id", "school_id", "academic_year", "name", "starts_on", "ends_on", "attendance_threshold", "is_active"], dataset["terms"],
        conflict=" ON CONFLICT(id) DO UPDATE SET academic_year=excluded.academic_year,name=excluded.name,starts_on=excluded.starts_on,ends_on=excluded.ends_on,attendance_threshold=excluded.attendance_threshold,is_active=excluded.is_active",
    )
    statements += insert_sql(
        "class_sections", ["id", "school_id", "academic_year", "grade", "section", "board", "room_number"], dataset["sections"],
        conflict=" ON CONFLICT(id) DO UPDATE SET academic_year=excluded.academic_year,grade=excluded.grade,section=excluded.section,board=excluded.board,room_number=excluded.room_number",
    )
    statements += insert_sql(
        "enrollments", ["id", "student_id", "class_section_id", "term_id", "roll_number", "is_active"], dataset["enrollments"],
        conflict=" ON CONFLICT(id) DO UPDATE SET student_id=excluded.student_id,class_section_id=excluded.class_section_id,term_id=excluded.term_id,roll_number=excluded.roll_number,is_active=excluded.is_active",
    )
    statements += insert_sql(
        "subjects", ["id", "school_id", "code", "name", "short_name", "color", "icon"], dataset["subjects"],
        conflict=" ON CONFLICT(id) DO UPDATE SET code=excluded.code,name=excluded.name,short_name=excluded.short_name,color=excluded.color,icon=excluded.icon",
    )
    statements += insert_sql(
        "subject_attendance", ["id", "student_id", "subject_id", "term_id", "classes_held", "classes_attended", "classes_excused"], dataset["subject_attendance"],
        conflict=" ON CONFLICT(student_id,subject_id,term_id) DO UPDATE SET classes_held=excluded.classes_held,classes_attended=excluded.classes_attended,classes_excused=excluded.classes_excused",
    )
    statements += insert_sql(
        "attendance_policies", ["id", "term_id", "name", "minimum_percentage", "medical_document_after_days", "policy_text"], dataset["policies"],
        conflict=" ON CONFLICT(term_id) DO UPDATE SET name=excluded.name,minimum_percentage=excluded.minimum_percentage,medical_document_after_days=excluded.medical_document_after_days,policy_text=excluded.policy_text",
    )
    statements += insert_sql(
        "timetable_slots", ["id", "class_section_id", "term_id", "subject_id", "weekday", "period_number", "starts_at", "ends_at", "slot_type", "title", "room", "teacher_user_id", "teacher_designation"], dataset["timetable"],
        conflict=" ON CONFLICT(class_section_id,term_id,weekday,period_number) DO UPDATE SET subject_id=excluded.subject_id,starts_at=excluded.starts_at,ends_at=excluded.ends_at,slot_type=excluded.slot_type,title=excluded.title,room=excluded.room,teacher_user_id=excluded.teacher_user_id,teacher_designation=excluded.teacher_designation",
    )
    statements += insert_sql(
        "class_section_staff_assignments", [
            "id", "school_id", "class_section_id", "user_id", "role", "subject_id", "valid_from", "valid_until",
            "assigned_by", "created_at",
        ], dataset["class_staff_assignments"], conflict=" ON CONFLICT DO NOTHING",
    )
    statements += insert_sql(
        "attendance_records", ["id", "student_id", "class_section_id", "date", "status", "check_in_at", "check_out_at", "remarks", "marked_by"], dataset["attendance"],
        conflict=" ON CONFLICT(student_id,date) DO UPDATE SET class_section_id=excluded.class_section_id,status=excluded.status,check_in_at=excluded.check_in_at,check_out_at=excluded.check_out_at,remarks=excluded.remarks,marked_by=excluded.marked_by,updated_at=now()", batch_size=750,
    )
    statements += insert_sql("gate_events", ["id", "student_id", "occurred_at", "direction", "gate", "source", "device_reference"], dataset["gate_events"], conflict=" ON CONFLICT(id) DO UPDATE SET occurred_at=excluded.occurred_at,direction=excluded.direction,gate=excluded.gate,source=excluded.source,device_reference=excluded.device_reference", batch_size=750)
    statements += insert_sql(
        "leave_requests", ["id", "student_id", "term_id", "requested_by", "category", "starts_on", "ends_on", "reason", "status", "submitted_at", "guardian_authorized_by", "guardian_authorized_at", "decided_by", "decided_at"], dataset["leaves"],
        conflict=" ON CONFLICT(id) DO UPDATE SET student_id=excluded.student_id,term_id=excluded.term_id,requested_by=excluded.requested_by,category=excluded.category,starts_on=excluded.starts_on,ends_on=excluded.ends_on,reason=excluded.reason,status=excluded.status,submitted_at=excluded.submitted_at,guardian_authorized_by=excluded.guardian_authorized_by,guardian_authorized_at=excluded.guardian_authorized_at,decided_by=excluded.decided_by,decided_at=excluded.decided_at,updated_at=now()",
    )
    statements += insert_sql("leave_audits", ["id", "leave_request_id", "actor_id", "action", "from_status", "to_status", "note", "created_at"], dataset["leave_audits"], conflict=" ON CONFLICT(id) DO NOTHING")
    statements += insert_sql(
        "diary_items", ["id", "school_id", "class_section_id", "term_id", "date", "item_type", "subject_id", "title", "body", "author_id", "due_at", "requires_acknowledgement", "published_at"], dataset["diary"],
        conflict=" ON CONFLICT(id) DO UPDATE SET date=excluded.date,item_type=excluded.item_type,subject_id=excluded.subject_id,title=excluded.title,body=excluded.body,author_id=excluded.author_id,due_at=excluded.due_at,requires_acknowledgement=excluded.requires_acknowledgement,published_at=excluded.published_at",
    )
    statements += insert_sql("diary_acknowledgements", ["id", "item_id", "student_id", "acknowledged_by", "acknowledged_at"], dataset["diary_acknowledgements"], conflict=" ON CONFLICT(item_id,student_id) DO UPDATE SET acknowledged_by=excluded.acknowledged_by,acknowledged_at=excluded.acknowledged_at")
    statements += insert_sql("diary_notes", ["id", "item_id", "student_id", "author_id", "body", "created_at"], dataset["diary_notes"], conflict=" ON CONFLICT(id) DO UPDATE SET body=excluded.body,author_id=excluded.author_id,created_at=excluded.created_at")
    statements += insert_sql("notifications", ["id", "recipient_id", "kind", "title", "body", "link", "metadata", "read_at", "created_at"], dataset["notifications"], conflict=" ON CONFLICT(id) DO UPDATE SET recipient_id=excluded.recipient_id,kind=excluded.kind,title=excluded.title,body=excluded.body,link=excluded.link,metadata=excluded.metadata,read_at=excluded.read_at,created_at=excluded.created_at")
    statements += insert_sql("school_contacts", ["id", "school_id", "label", "name", "phone", "email", "availability", "priority"], dataset["contacts"], conflict=" ON CONFLICT(id) DO UPDATE SET label=excluded.label,name=excluded.name,phone=excluded.phone,email=excluded.email,availability=excluded.availability,priority=excluded.priority")
    statements += insert_sql(
        "fee_invoices", [
            "id", "school_id", "student_id", "reference", "description", "amount_paise", "due_on", "created_by", "created_at",
        ], dataset["campus_event_fee_invoices"], conflict=" ON CONFLICT DO NOTHING",
    )
    payment_columns = [
        "id", "school_id", "invoice_id", "amount_paise", "method", "reference", "idempotency_key", "recorded_by", "created_at",
    ]
    # Payment balance validation also runs before conflict handling. Do not
    # present an already-posted immutable payment to that trigger on re-seed.
    for payment in dataset["campus_event_fee_payments"]:
        values_sql = ",".join(sql_value(value) for value in payment)
        statements.append(f"""
INSERT INTO fee_payments({','.join(payment_columns)})
SELECT {values_sql}
WHERE NOT EXISTS (
  SELECT 1 FROM fee_payments existing
  WHERE existing.id='{payment[0]}'::uuid OR existing.idempotency_key='{payment[6]}'::uuid
)
ON CONFLICT DO NOTHING;
""")
    # Demo events are inserted after every identity/scope dependency.  They are
    # deliberately immutable on a re-seed so review activity is never reset.
    statements += insert_sql(
        "campus_events", [
            "id", "school_id", "event_type", "status", "title", "description", "venue", "starts_at", "ends_at",
            "audience_mode", "participation_requirement", "requires_rsvp", "requires_guardian_consent",
            "payment_required", "academic_attendance_impact", "revision", "created_by", "published_by",
            "published_at", "cancelled_by", "cancelled_at", "cancellation_reason", "completed_by", "completed_at",
            "created_at", "updated_at", "payment_amount_paise", "payment_due_on", "payment_currency", "subject_id",
        ], dataset["campus_events"], conflict=" ON CONFLICT DO NOTHING",
    )
    statements += insert_sql(
        "campus_event_class_sections", ["school_id", "event_id", "class_section_id"],
        dataset["campus_event_class_sections"], conflict=" ON CONFLICT DO NOTHING",
    )
    statements += insert_sql(
        "campus_event_selected_students", ["school_id", "event_id", "student_id"],
        dataset["campus_event_selected_students"], conflict=" ON CONFLICT DO NOTHING",
    )
    statements += insert_sql(
        "campus_event_staff", ["school_id", "event_id", "user_id", "role", "assigned_at"],
        dataset["campus_event_staff"], conflict=" ON CONFLICT DO NOTHING",
    )
    statements += insert_sql(
        "campus_event_sessions", [
            "id", "school_id", "event_id", "title", "session_type", "venue", "starts_at", "ends_at",
            "attendance_mode", "state", "revision", "locked_by", "locked_at", "reopened_by", "reopened_at",
            "reopen_reason", "created_at", "updated_at",
        ], dataset["campus_event_sessions"], conflict=" ON CONFLICT DO NOTHING",
    )
    statements += insert_sql(
        "campus_event_session_selected_students", ["school_id", "event_id", "session_id", "student_id"],
        dataset["campus_event_session_selected_students"], conflict=" ON CONFLICT DO NOTHING",
    )
    statements += insert_sql(
        "campus_event_participants", [
            "school_id", "event_id", "student_id", "participation_requirement", "rsvp_status", "fee_invoice_id",
            "invited_at", "rsvp_by", "rsvp_at",
        ], dataset["campus_event_participants"], conflict=" ON CONFLICT DO NOTHING",
    )
    statements += insert_sql(
        "campus_event_session_participants", [
            "school_id", "event_id", "session_id", "student_id", "participation_requirement",
        ], dataset["campus_event_session_participants"], conflict=" ON CONFLICT DO NOTHING",
    )
    authority_columns = [
        "id", "school_id", "relationship_id", "status", "valid_from", "valid_until", "source", "provenance",
        "revision", "granted_by", "granted_at", "revoked_by", "revoked_at", "revocation_reason",
    ]
    # The authority grant validator is a BEFORE INSERT trigger, so ON CONFLICT
    # alone is not repeat-safe: the trigger fires before PostgreSQL can discard
    # the duplicate. Guard every immutable grant by relationship history first.
    for authority in dataset["campus_event_consent_authorities"]:
        values_sql = ",".join(sql_value(value) for value in authority)
        statements.append(f"""
INSERT INTO campus_event_consent_authorities({','.join(authority_columns)})
SELECT {values_sql}
WHERE NOT EXISTS (
  SELECT 1 FROM campus_event_consent_authorities existing
  WHERE existing.school_id='{authority[1]}'::uuid
    AND existing.relationship_id='{authority[2]}'::uuid
)
ON CONFLICT DO NOTHING;
""")
    # A review database may contain legitimate students enrolled after the
    # deterministic 200-student fixture was first loaded. Reconcile those
    # students into upcoming class-scoped invitations without overwriting any
    # family decision or inventing attendance. Completed/locked events are
    # historical evidence and are intentionally never reconciled. Optional
    # event additions remain pending and stay out of session rosters.
    statements.append(f"""
INSERT INTO campus_event_participants(
  school_id,event_id,student_id,participation_requirement,rsvp_status,fee_invoice_id,
  invited_at,rsvp_by,rsvp_at
)
SELECT '{school_id}'::uuid,'{picnic_event_id}'::uuid,enrollment.student_id,'optional','pending',NULL,now(),NULL,NULL
FROM enrollments enrollment
JOIN academic_terms term ON term.id=enrollment.term_id
JOIN campus_events event ON event.id='{picnic_event_id}'::uuid AND event.school_id='{school_id}'::uuid
JOIN schools school ON school.id=event.school_id
WHERE enrollment.class_section_id='{class_7a_id}'::uuid AND enrollment.is_active
  AND event.status='published' AND event.starts_at>now()
  AND enrollment.enrolled_on<=(event.starts_at AT TIME ZONE school.timezone)::date
  AND (event.starts_at AT TIME ZONE school.timezone)::date BETWEEN term.starts_on AND term.ends_on
ON CONFLICT(event_id,student_id) DO NOTHING;

INSERT INTO campus_event_participants(
  school_id,event_id,student_id,participation_requirement,rsvp_status,fee_invoice_id,
  invited_at,rsvp_by,rsvp_at
)
SELECT '{school_id}'::uuid,'{class_test_event_id}'::uuid,enrollment.student_id,'mandatory','pending',NULL,now(),NULL,NULL
FROM enrollments enrollment
JOIN academic_terms term ON term.id=enrollment.term_id
JOIN campus_events event ON event.id='{class_test_event_id}'::uuid AND event.school_id='{school_id}'::uuid
JOIN schools school ON school.id=event.school_id
JOIN campus_event_sessions session
  ON session.event_id=event.id AND session.id='{class_test_session_id}'::uuid
WHERE enrollment.class_section_id='{class_7a_id}'::uuid AND enrollment.is_active
  AND event.status='published' AND event.starts_at>now() AND session.state='open'
  AND enrollment.enrolled_on<=(event.starts_at AT TIME ZONE school.timezone)::date
  AND (event.starts_at AT TIME ZONE school.timezone)::date BETWEEN term.starts_on AND term.ends_on
ON CONFLICT(event_id,student_id) DO NOTHING;

INSERT INTO campus_event_session_participants(
  school_id,event_id,session_id,student_id,participation_requirement
)
SELECT '{school_id}'::uuid,'{class_test_event_id}'::uuid,'{class_test_session_id}'::uuid,
  participant.student_id,'mandatory'
FROM campus_event_participants participant
WHERE participant.event_id='{class_test_event_id}'::uuid
ON CONFLICT(session_id,student_id) DO NOTHING;

INSERT INTO campus_event_consent_authorities(
  id,school_id,relationship_id,status,valid_from,valid_until,source,provenance,
  revision,granted_by,granted_at,revoked_by,revoked_at,revocation_reason
)
SELECT md5('eduvera:demo:event-consent:' || relationship.id::text)::uuid,
  relationship.school_id,relationship.id,'active',
  COALESCE((SELECT min(term.starts_on) FROM academic_terms term
    WHERE term.school_id=relationship.school_id AND term.is_active),current_date),
  NULL,'enrollment','Primary guardian relationship verified during repeat-safe demo reconciliation.',
  1,'{principal_id}'::uuid,now(),NULL,NULL,NULL
FROM campus_event_participants participant
JOIN LATERAL (
  SELECT candidate.* FROM guardian_relationships candidate
  WHERE candidate.school_id=participant.school_id AND candidate.student_id=participant.student_id
  ORDER BY candidate.is_primary DESC,candidate.created_at,candidate.id
  LIMIT 1
) relationship ON true
WHERE participant.event_id='{picnic_event_id}'::uuid
  AND NOT EXISTS (
    SELECT 1 FROM campus_event_consent_authorities authority
    WHERE authority.school_id=relationship.school_id AND authority.relationship_id=relationship.id
  )
ON CONFLICT(id) DO NOTHING;
""")
    statements += insert_sql(
        "campus_event_consents", [
            "school_id", "event_id", "student_id", "relationship_id", "authority_id", "status", "note",
            "decided_by", "decided_at", "revision",
        ], dataset["campus_event_consents"], conflict=" ON CONFLICT DO NOTHING",
    )
    statements += insert_sql(
        "campus_event_checklist_items", ["id", "school_id", "event_id", "label", "required", "sort_order"],
        dataset["campus_event_checklist_items"], conflict=" ON CONFLICT DO NOTHING",
    )
    statements += insert_sql(
        "campus_event_checklist_completions", [
            "school_id", "event_id", "item_id", "student_id", "completed_by", "completed_at",
        ], dataset["campus_event_checklist_completions"], conflict=" ON CONFLICT DO NOTHING",
    )
    statements += insert_sql(
        "campus_event_attendance_records", [
            "id", "school_id", "event_id", "session_id", "student_id", "status", "note", "checked_in_at", "checked_out_at", "revision",
            "marked_by", "marked_at", "updated_at",
        ], dataset["campus_event_attendance"], conflict=" ON CONFLICT DO NOTHING",
    )
    statements += insert_sql(
        "campus_event_attendance_revisions", [
            "school_id", "event_id", "session_id", "student_id", "attendance_record_id", "previous_status",
            "new_status", "previous_note", "new_note", "previous_checked_in_at", "new_checked_in_at",
            "previous_checked_out_at", "new_checked_out_at", "reason", "revision", "changed_by", "request_id", "created_at",
        ], dataset["campus_event_attendance_revisions"], conflict=" ON CONFLICT DO NOTHING",
    )

    expected_students = summary["students"]
    expected_days = summary["school_days"]
    expected_attendance = summary["attendance_records"]
    expected_subject_rows = summary["subject_attendance_rows"]
    expected_event_attendance = summary["campus_event_attendance_records"]
    expected_picnic_invoices = summary["picnic_fee_invoices"]
    expected_picnic_payments = summary["picnic_fee_payments"]
    statements.append(f"""
DO $$
DECLARE
  seeded_students integer;
BEGIN
  SELECT count(*) INTO seeded_students FROM students st JOIN omnischool_seed_student_ids seed ON seed.id=st.id;
  IF seeded_students <> {expected_students} THEN
    RAISE EXCEPTION 'Seed integrity failure: expected {expected_students} students, got %', seeded_students;
  END IF;
  IF EXISTS (
    SELECT 1 FROM students st JOIN omnischool_seed_student_ids seed ON seed.id=st.id
    LEFT JOIN enrollments e ON e.student_id=st.id AND e.is_active
    LEFT JOIN guardian_relationships gr ON gr.student_id=st.id AND gr.is_primary
    LEFT JOIN parents p ON p.id=gr.guardian_id
    LEFT JOIN school_memberships gm ON gm.user_id=p.user_id AND gm.school_id=st.school_id AND gm.role='guardian' AND gm.is_active
    GROUP BY st.id HAVING count(DISTINCT e.id) <> 1 OR count(DISTINCT gr.id) <> 1 OR count(DISTINCT gm.id) <> 1
  ) THEN
    RAISE EXCEPTION 'Seed integrity failure: a student is missing one enrollment or active primary guardian';
  END IF;
  IF (SELECT count(*) FROM attendance_records ar JOIN omnischool_seed_student_ids seed ON seed.id=ar.student_id JOIN omnischool_seed_days sd ON sd.day=ar.date) <> {expected_attendance} THEN
    RAISE EXCEPTION 'Seed integrity failure: attendance row count is incomplete';
  END IF;
  IF EXISTS (
    SELECT seed.id FROM omnischool_seed_student_ids seed
    LEFT JOIN attendance_records ar ON ar.student_id=seed.id AND ar.date IN (SELECT day FROM omnischool_seed_days)
    GROUP BY seed.id HAVING count(ar.id) <> {expected_days}
  ) THEN
    RAISE EXCEPTION 'Seed integrity failure: a student does not have {expected_days} daily attendance rows';
  END IF;
  IF (SELECT count(*) FROM subject_attendance sa JOIN omnischool_seed_student_ids seed ON seed.id=sa.student_id) <> {expected_subject_rows} THEN
    RAISE EXCEPTION 'Seed integrity failure: subject attendance is incomplete';
  END IF;
  IF EXISTS (
    SELECT 1 FROM timetable_slots ts JOIN class_sections cs ON cs.id=ts.class_section_id
    LEFT JOIN school_memberships m ON m.user_id=ts.teacher_user_id AND m.school_id=cs.school_id AND m.role='staff' AND m.is_active
    WHERE cs.school_id='{school_id}'::uuid AND ts.slot_type='class' AND m.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Seed integrity failure: a class timetable slot has no active teacher';
  END IF;
  IF (
    SELECT count(*) FROM campus_events
    WHERE school_id='{school_id}'::uuid AND id IN (
      '{annual_event_id}'::uuid,'{picnic_event_id}'::uuid,'{class_test_event_id}'::uuid
    )
  ) <> 3 THEN
    RAISE EXCEPTION 'Seed integrity failure: all three demo campus events were not loaded';
  END IF;
  IF EXISTS (
    SELECT 1 FROM campus_events
    WHERE id IN ('{annual_event_id}'::uuid,'{picnic_event_id}'::uuid,'{class_test_event_id}'::uuid)
      AND academic_attendance_impact<>'none'
  ) THEN
    RAISE EXCEPTION 'Seed integrity failure: campus event attendance must remain separate from academic attendance';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM campus_events
    WHERE id='{annual_event_id}'::uuid AND participation_requirement='mandatory'
      AND NOT requires_rsvp AND NOT requires_guardian_consent AND NOT payment_required
  ) OR NOT EXISTS (
    SELECT 1 FROM campus_events
    WHERE id='{picnic_event_id}'::uuid AND participation_requirement='optional'
      AND requires_rsvp AND requires_guardian_consent AND payment_required
  ) OR NOT EXISTS (
    SELECT 1 FROM campus_events
    WHERE id='{class_test_event_id}'::uuid AND participation_requirement='mandatory'
      AND NOT requires_rsvp AND NOT requires_guardian_consent AND NOT payment_required
  ) THEN
    RAISE EXCEPTION 'Seed integrity failure: independent event requirement dimensions are incorrect';
  END IF;
  IF EXISTS (
    SELECT 1 FROM omnischool_seed_student_ids seeded
    WHERE NOT EXISTS (
      SELECT 1 FROM campus_event_participants participant
      WHERE participant.event_id='{annual_event_id}'::uuid AND participant.student_id=seeded.id
    )
  ) THEN
    RAISE EXCEPTION 'Seed integrity failure: generated annual-event roster is incomplete';
  END IF;
  IF EXISTS (
    SELECT 1 FROM campus_event_participants participant
    WHERE participant.event_id='{annual_event_id}'::uuid
      AND NOT EXISTS (
        SELECT 1 FROM campus_event_session_participants roster
        WHERE roster.event_id=participant.event_id
          AND roster.session_id='{annual_main_session_id}'::uuid
          AND roster.student_id=participant.student_id
      )
  ) OR EXISTS (
    SELECT 1 FROM campus_event_participants participant
    WHERE participant.event_id='{class_test_event_id}'::uuid
      AND NOT EXISTS (
        SELECT 1 FROM campus_event_session_participants roster
        WHERE roster.event_id=participant.event_id
          AND roster.session_id='{class_test_session_id}'::uuid
          AND roster.student_id=participant.student_id
      )
  ) THEN
    RAISE EXCEPTION 'Seed integrity failure: mandatory event session rosters are incomplete';
  END IF;
  IF EXISTS (
    SELECT 1 FROM campus_event_session_participants roster
    JOIN campus_event_participants participant
      ON participant.school_id=roster.school_id AND participant.event_id=roster.event_id
      AND participant.student_id=roster.student_id
    WHERE roster.participation_requirement='optional' AND participant.rsvp_status<>'accepted'
  ) THEN
    RAISE EXCEPTION 'Seed integrity failure: an optional session roster includes an unaccepted RSVP';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM enrollments enrollment
    JOIN academic_terms term ON term.id=enrollment.term_id
    JOIN campus_events event ON event.id='{picnic_event_id}'::uuid
    JOIN schools school ON school.id=event.school_id
    WHERE enrollment.class_section_id='{class_7a_id}'::uuid AND enrollment.is_active
      AND event.status='published' AND event.starts_at>now()
      AND enrollment.enrolled_on<=(event.starts_at AT TIME ZONE school.timezone)::date
      AND (event.starts_at AT TIME ZONE school.timezone)::date BETWEEN term.starts_on AND term.ends_on
      AND NOT EXISTS (
        SELECT 1 FROM campus_event_participants participant
        WHERE participant.event_id=event.id AND participant.student_id=enrollment.student_id
      )
  ) OR EXISTS (
    SELECT 1
    FROM enrollments enrollment
    JOIN academic_terms term ON term.id=enrollment.term_id
    JOIN campus_events event ON event.id='{class_test_event_id}'::uuid
    JOIN schools school ON school.id=event.school_id
    JOIN campus_event_sessions session
      ON session.event_id=event.id AND session.id='{class_test_session_id}'::uuid
    WHERE enrollment.class_section_id='{class_7a_id}'::uuid AND enrollment.is_active
      AND event.status='published' AND event.starts_at>now() AND session.state='open'
      AND enrollment.enrolled_on<=(event.starts_at AT TIME ZONE school.timezone)::date
      AND (event.starts_at AT TIME ZONE school.timezone)::date BETWEEN term.starts_on AND term.ends_on
      AND NOT EXISTS (
        SELECT 1 FROM campus_event_participants participant
        WHERE participant.event_id=event.id AND participant.student_id=enrollment.student_id
      )
  ) THEN
    RAISE EXCEPTION 'Seed integrity failure: an eligible Class 7A event participant is missing';
  END IF;
  IF EXISTS (
    SELECT 1 FROM campus_event_participants participant
    LEFT JOIN LATERAL (
      SELECT candidate.* FROM guardian_relationships candidate
      WHERE candidate.student_id=participant.student_id AND candidate.school_id=participant.school_id
      ORDER BY candidate.is_primary DESC,candidate.created_at,candidate.id
      LIMIT 1
    ) relationship ON true
    WHERE participant.event_id='{picnic_event_id}'::uuid
      AND (
        relationship.id IS NULL OR NOT EXISTS (
          SELECT 1 FROM campus_event_consent_authorities authority
          WHERE authority.relationship_id=relationship.id AND authority.school_id=relationship.school_id
        )
      )
  ) THEN
    RAISE EXCEPTION 'Seed integrity failure: a picnic participant is missing guardian consent-authority history';
  END IF;
  IF (
    SELECT count(*) FROM fee_invoices invoice
    JOIN campus_event_participants participant ON participant.fee_invoice_id=invoice.id
    WHERE participant.event_id='{picnic_event_id}'::uuid
      AND invoice.school_id=participant.school_id AND invoice.student_id=participant.student_id
  ) <> {expected_picnic_invoices} THEN
    RAISE EXCEPTION 'Seed integrity failure: paid picnic fee invoices are incomplete or cross-linked';
  END IF;
  IF EXISTS (
    SELECT 1 FROM campus_event_participants participant
    WHERE participant.event_id='{picnic_event_id}'::uuid
      AND ((participant.rsvp_status='accepted')<>(participant.fee_invoice_id IS NOT NULL))
  ) THEN
    RAISE EXCEPTION 'Seed integrity failure: picnic fee obligation does not match accepted RSVP';
  END IF;
  IF (
    SELECT count(*) FROM fee_payments payment
    JOIN campus_event_participants participant ON participant.fee_invoice_id=payment.invoice_id
    WHERE participant.event_id='{picnic_event_id}'::uuid
  ) < {expected_picnic_payments} THEN
    RAISE EXCEPTION 'Seed integrity failure: picnic fee payment examples are incomplete';
  END IF;
  IF EXISTS (
    SELECT 1 FROM campus_event_checklist_items item
    WHERE item.event_id='{picnic_event_id}'::uuid AND NOT item.required
  ) THEN
    RAISE EXCEPTION 'Seed integrity failure: picnic kit contains a non-required item';
  END IF;
  IF (
    SELECT count(*) FROM campus_event_session_selected_students selected
    WHERE selected.event_id='{annual_event_id}'::uuid
      AND selected.session_id='{deterministic_id("campus-event-annual-function-rehearsal-2026")}'::uuid
  ) <> 15 OR (
    SELECT count(*) FROM campus_event_session_participants participant
    WHERE participant.event_id='{annual_event_id}'::uuid
      AND participant.session_id='{deterministic_id("campus-event-annual-function-rehearsal-2026")}'::uuid
      AND participant.participation_requirement='mandatory'
  ) <> 15 THEN
    RAISE EXCEPTION 'Seed integrity failure: Annual Function rehearsal roster is incomplete';
  END IF;
  IF EXISTS (
    SELECT 1 FROM campus_event_sessions session
    WHERE session.event_id='{annual_event_id}'::uuid AND session.attendance_mode<>'none' AND session.state<>'locked'
  ) THEN
    RAISE EXCEPTION 'Seed integrity failure: completed Annual Function registers are not locked';
  END IF;
  IF (
    SELECT count(*) FROM campus_event_attendance_records
    WHERE event_id='{annual_event_id}'::uuid
  ) <> {expected_event_attendance} THEN
    RAISE EXCEPTION 'Seed integrity failure: Annual Function attendance is incomplete';
  END IF;
  IF EXISTS (
    SELECT 1 FROM campus_event_attendance_records
    WHERE event_id IN ('{picnic_event_id}'::uuid,'{class_test_event_id}'::uuid)
  ) THEN
    RAISE EXCEPTION 'Seed integrity failure: a future event contains fabricated attendance';
  END IF;
  IF (
    SELECT count(*) FROM campus_event_attendance_revisions revision
    JOIN campus_event_attendance_records attendance ON attendance.id=revision.attendance_record_id
    WHERE attendance.event_id='{annual_event_id}'::uuid
  ) <> {expected_event_attendance} THEN
    RAISE EXCEPTION 'Seed integrity failure: event attendance revision history is incomplete';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM campus_events event
    JOIN campus_event_class_sections scope
      ON scope.school_id=event.school_id AND scope.event_id=event.id
    JOIN class_section_staff_assignments assignment
      ON assignment.school_id=scope.school_id AND assignment.class_section_id=scope.class_section_id
      AND assignment.user_id=event.created_by AND assignment.subject_id=event.subject_id
      AND assignment.role='subject_teacher'
      AND (event.starts_at AT TIME ZONE 'Asia/Kolkata')::date
        BETWEEN assignment.valid_from AND COALESCE(assignment.valid_until,'infinity'::date)
    JOIN timetable_slots slot
      ON slot.class_section_id=scope.class_section_id AND slot.subject_id=event.subject_id
      AND slot.teacher_user_id=event.created_by
      AND slot.weekday=extract(isodow FROM event.starts_at AT TIME ZONE 'Asia/Kolkata')::integer
      AND slot.starts_at=(event.starts_at AT TIME ZONE 'Asia/Kolkata')::time
    WHERE event.id='{class_test_event_id}'::uuid AND event.event_type='class_test'
      AND event.subject_id='{deterministic_id("subject-mat")}'::uuid
      AND scope.class_section_id='{deterministic_id("class-7a")}'::uuid
      AND event.created_by='{deterministic_id("user-kavita")}'::uuid
  ) THEN
    RAISE EXCEPTION 'Seed integrity failure: class test is not linked to Kavita Mehta, Class 7A and Mathematics';
  END IF;
END $$;
ANALYZE users;
ANALYZE students;
ANALYZE enrollments;
ANALYZE attendance_records;
ANALYZE timetable_slots;
ANALYZE class_section_staff_assignments;
ANALYZE campus_events;
ANALYZE campus_event_participants;
ANALYZE campus_event_session_participants;
ANALYZE campus_event_attendance_records;
ANALYZE fee_invoices;
ANALYZE fee_payments;
COMMIT;
""".strip())
    return "\n\n".join(statements) + "\n"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate a complete 200-student OmniSchool PostgreSQL seed.")
    parser.add_argument("--as-of", type=date.fromisoformat, default=datetime.now(IST).date(), help="Seed date in YYYY-MM-DD (default: today in Asia/Kolkata).")
    parser.add_argument("--seed", type=int, default=20260911, help="Deterministic random seed.")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT, help="SQL output path.")
    parser.add_argument("--summary-output", type=Path, default=DEFAULT_SUMMARY, help="JSON summary output path.")
    parser.add_argument("--load", action="store_true", help="Load the generated transaction into DATABASE_URL with psql.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    load_dotenv(BACKEND_ROOT / ".env")
    demo_password = os.environ.get("DEMO_PASSWORD", "OmniDemo@2026")
    dataset, summary = build_dataset(args.as_of, args.seed, demo_password)
    sql = render_sql(dataset, summary)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.summary_output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(sql, encoding="utf-8")
    args.summary_output.write_text(json.dumps(summary, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(
        f"Generated {summary['students']} students, {summary['parents']} parents, "
        f"{summary['teachers_and_staff']} teachers/staff and {summary['attendance_records']} attendance rows."
    )
    print(f"SQL: {args.output}")
    print(f"Summary: {args.summary_output}")
    if args.load:
        database_url = os.environ.get("DATABASE_URL")
        if not database_url:
            raise RuntimeError("DATABASE_URL is required with --load.")
        psql = shutil.which("psql")
        if not psql:
            raise RuntimeError("psql is required with --load. Install the PostgreSQL client or omit --load.")
        result = subprocess.run(
            [psql, database_url, "-X", "-v", "ON_ERROR_STOP=1", "-f", str(args.output)],
            text=True,
            capture_output=True,
            check=False,
        )
        if result.returncode:
            sys.stderr.write(result.stderr)
            return result.returncode
        print(f"Loaded and verified {SCHOOL_NAME} in PostgreSQL.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
