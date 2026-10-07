from .conftest import TOKEN, picture


def test_health_does_not_make_an_accuracy_claim(client):
    health = client.get("/api/health").json()
    assert health["accuracy_validated"] is False
    assert health["single_operator"] is True


def test_private_routes_require_service_authentication(client):
    response = client.get("/api/classes", headers={"Authorization": ""})
    assert response.status_code == 401
    assert response.headers["cache-control"] == "no-store"


def test_api_has_no_prototype_frontend(client):
    assert client.get("/").status_code == 404
    assert client.get("/api/openapi.json").status_code == 404


def test_class_photo_never_infers_absence(client, seeded):
    classroom, students = seeded
    response = client.post(
        f"/api/classes/{classroom['id']}/sessions",
        data={
            "attendance_date": "2026-09-16",
            "authorized": "true",
            "period": "Period 1",
        },
        files={"file": ("classroom.png", picture(10), "image/png")},
    )
    assert response.status_code == 201, response.text
    result = response.json()["result"]
    statuses = {student["id"]: student["suggested_status"] for student in result["roster"]}
    assert result["summary"]["auto_present"] == 2
    assert statuses[students[2]["id"]] == "needs_review"
    assert "absent" not in statuses.values()


def test_zero_faces_leaves_every_student_for_review(client, seeded):
    classroom, _students = seeded
    response = client.post(
        f"/api/classes/{classroom['id']}/sessions",
        data={
            "attendance_date": "2026-09-16",
            "authorized": "true",
            "period": "Period 1",
        },
        files={"file": ("empty.png", picture(0), "image/png")},
    )
    assert response.status_code == 201, response.text
    result = response.json()["result"]
    assert result["summary"]["auto_present"] == 0
    assert all(row["suggested_status"] == "needs_review" for row in result["roster"])


def test_wrong_service_token_is_rejected(client):
    response = client.get(
        "/api/classes",
        headers={"Authorization": "Bearer wrong-token-which-is-long-enough"},
    )
    assert response.status_code == 401
    assert TOKEN not in response.text


def test_reference_enrollment_accepts_a_usable_lower_confidence_angle(client):
    classroom = client.post("/api/classes", json={"name": "Synthetic Class 7A"}).json()
    student = client.post(
        f"/api/classes/{classroom['id']}/students",
        json={
            "roll_number": "11",
            "name": "Side angle student",
            "authorization_record": "Synthetic test authorization",
            "authorized": True,
        },
    ).json()

    response = client.post(
        f"/api/students/{student['id']}/samples",
        files=[("files", ("side-angle.png", picture(20), "image/png"))],
    )

    assert response.status_code == 200, response.text
    assert response.json()["total_samples"] == 1


def test_reference_enrollment_explains_when_no_face_is_usable(client):
    classroom = client.post("/api/classes", json={"name": "Synthetic Class 7A"}).json()
    student = client.post(
        f"/api/classes/{classroom['id']}/students",
        json={
            "roll_number": "12",
            "name": "No face student",
            "authorization_record": "Synthetic test authorization",
            "authorized": True,
        },
    ).json()

    response = client.post(
        f"/api/students/{student['id']}/samples",
        files=[("files", ("no-face.png", picture(0), "image/png"))],
    )

    assert response.status_code == 422
    assert "no usable face was detected" in response.json()["detail"]
    assert "found 0" not in response.json()["detail"]


def test_clear_face_above_detector_floor_can_be_suggested_present(client, seeded):
    classroom, students = seeded
    response = client.post(
        f"/api/classes/{classroom['id']}/sessions",
        data={
            "attendance_date": "2026-09-16",
            "authorized": "true",
            "period": "Period 1",
        },
        files={"file": ("lower-confidence.png", picture(21), "image/png")},
    )

    assert response.status_code == 201, response.text
    result = response.json()["result"]
    assert result["summary"]["auto_present"] == 1
    assert result["automatic_assignments"] == [{
        "face_id": "f001",
        "student_id": students[0]["id"],
        "source": "face_embeddings",
    }]


def test_nested_facial_region_detection_is_suppressed(client, seeded):
    classroom, _students = seeded
    response = client.post(
        f"/api/classes/{classroom['id']}/sessions",
        data={
            "attendance_date": "2026-09-16",
            "authorized": "true",
            "period": "Period 1",
        },
        files={"file": ("nested-region.png", picture(30), "image/png")},
    )

    assert response.status_code == 201, response.text
    result = response.json()["result"]
    assert result["summary"]["detected_faces"] == 1
    assert len(result["faces"]) == 1
    assert result["faces"][0]["box"] == [40.0, 20.0, 220.0, 200.0]


def test_local_llm_mode_is_available_and_used_when_requested(llm_client):
    status = llm_client.get("/api/llm/status").json()
    assert status == {
        "available": True,
        "installed": True,
        "supports_images": True,
        "model": "synthetic-vision-only",
    }
    classroom = llm_client.post("/api/classes", json={"name": "Synthetic Class 7A"}).json()
    students = []
    for index in range(1, 3):
        student = llm_client.post(
            f"/api/classes/{classroom['id']}/students",
            json={
                "roll_number": f"{index:02d}",
                "name": f"Test student {index}",
                "authorization_record": "Synthetic test authorization",
                "authorized": True,
            },
        ).json()
        enrolled = llm_client.post(
            f"/api/students/{student['id']}/samples",
            files=[("files", (f"{index}.png", picture(index), "image/png"))],
        )
        assert enrolled.status_code == 200, enrolled.text
        students.append(student)
    response = llm_client.post(
        f"/api/classes/{classroom['id']}/sessions",
        data={
            "attendance_date": "2026-09-16",
            "authorized": "true",
            "period": "Period 1",
            "use_llm": "true",
        },
        files={"file": ("classroom.png", picture(1), "image/png")},
    )
    assert response.status_code == 201, response.text
    result = response.json()["result"]
    assert result["analysis_mode"] == "local_llm"
    assert result["automatic_assignments"] == [{
        "face_id": "f001",
        "student_id": students[0]["id"],
        "source": "local_llm",
        "confidence": 0.93,
    }]


def test_non_vision_local_model_falls_back_to_face_matching(non_vision_llm_client):
    status = non_vision_llm_client.get("/api/llm/status").json()
    assert status["supports_images"] is False

    classroom = non_vision_llm_client.post("/api/classes", json={"name": "Synthetic Class 7A"}).json()
    student = non_vision_llm_client.post(
        f"/api/classes/{classroom['id']}/students",
        json={
            "roll_number": "01",
            "name": "Test student 1",
            "authorization_record": "Synthetic test authorization",
            "authorized": True,
        },
    ).json()
    enrolled = non_vision_llm_client.post(
        f"/api/students/{student['id']}/samples",
        files=[("files", ("1.png", picture(1), "image/png"))],
    )
    assert enrolled.status_code == 200, enrolled.text

    response = non_vision_llm_client.post(
        f"/api/classes/{classroom['id']}/sessions",
        data={
            "attendance_date": "2026-09-16",
            "authorized": "true",
            "period": "Period 1",
            "use_llm": "true",
        },
        files={"file": ("classroom.png", picture(1), "image/png")},
    )

    assert response.status_code == 201, response.text
    result = response.json()["result"]
    assert result["analysis_mode"] == "face_embeddings"
    assert result["summary"]["auto_present"] == 1
    assert "does not support image input" in " ".join(result["warnings"])


def test_multimodal_model_error_does_not_fail_photo_analysis(failing_llm_client):
    classroom = failing_llm_client.post("/api/classes", json={"name": "Synthetic Class 7A"}).json()
    student = failing_llm_client.post(
        f"/api/classes/{classroom['id']}/students",
        json={
            "roll_number": "01",
            "name": "Test student 1",
            "authorization_record": "Synthetic test authorization",
            "authorized": True,
        },
    ).json()
    enrolled = failing_llm_client.post(
        f"/api/students/{student['id']}/samples",
        files=[("files", ("1.png", picture(1), "image/png"))],
    )
    assert enrolled.status_code == 200, enrolled.text

    response = failing_llm_client.post(
        f"/api/classes/{classroom['id']}/sessions",
        data={
            "attendance_date": "2026-09-16",
            "authorized": "true",
            "period": "Period 1",
            "use_llm": "true",
        },
        files={"file": ("classroom.png", picture(1), "image/png")},
    )

    assert response.status_code == 201, response.text
    result = response.json()["result"]
    assert result["analysis_mode"] == "face_embeddings"
    assert result["summary"]["auto_present"] == 1
    assert "does not support image input" in " ".join(result["warnings"])
