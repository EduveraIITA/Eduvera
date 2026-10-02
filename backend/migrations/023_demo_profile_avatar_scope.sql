-- Keep demo portraits attached to named demo identities, not unrelated people who
-- happen to share a name in the generated 200-student school.
UPDATE school_people person SET avatar_url=''
FROM guardian_school_profiles profile
JOIN parents parent ON parent.id=profile.guardian_id
LEFT JOIN users account ON account.id=parent.user_id
WHERE person.id=profile.person_id
  AND concat_ws(' ',person.first_name,person.last_name)='Pooja Sharma'
  AND account.username IS DISTINCT FROM 'pooja.parent';

UPDATE users SET avatar_url = CASE username
  WHEN 'parent.cis0103' THEN '/assets/rashmi-joshi.png'
  WHEN 'parent.cis0093' THEN '/assets/pooja-chauhan.png'
  ELSE avatar_url
END
WHERE username IN ('parent.cis0103','parent.cis0093');
