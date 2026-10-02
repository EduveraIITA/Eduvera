UPDATE school_people person SET avatar_url = (ARRAY[
  '/assets/pooja-sharma.png',
  '/assets/rashmi-joshi.png',
  '/assets/nandita-deshmukh.png',
  '/assets/pooja-chauhan.png'
])[1 + (get_byte(decode(md5(person.id::text), 'hex'), 0) % 4)]
FROM guardian_school_profiles profile
WHERE person.id=profile.person_id AND person.avatar_url='';

UPDATE users account SET avatar_url=person.avatar_url
FROM parents parent
JOIN guardian_school_profiles profile ON profile.guardian_id=parent.id
JOIN school_people person ON person.id=profile.person_id
WHERE account.id=parent.user_id AND account.avatar_url='' AND person.avatar_url<>'';
