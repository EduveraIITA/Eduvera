ALTER TABLE users ADD COLUMN avatar_url text NOT NULL DEFAULT '';
ALTER TABLE school_people ADD COLUMN avatar_url text NOT NULL DEFAULT '';

UPDATE users SET avatar_url = CASE username
  WHEN 'pooja.parent' THEN '/assets/pooja-sharma.png'
  WHEN 'kavita.staff' THEN '/assets/kavita-mehta.png'
  WHEN 'meera.principal' THEN '/assets/meera-kapoor.png'
  ELSE avatar_url
END
WHERE username IN ('pooja.parent', 'kavita.staff', 'meera.principal');

UPDATE school_people SET avatar_url = CASE concat_ws(' ', first_name, last_name)
  WHEN 'Pooja Sharma' THEN '/assets/pooja-sharma.png'
  WHEN 'Rashmi Joshi' THEN '/assets/rashmi-joshi.png'
  WHEN 'Nandita Deshmukh' THEN '/assets/nandita-deshmukh.png'
  WHEN 'Pooja Chauhan' THEN '/assets/pooja-chauhan.png'
  ELSE avatar_url
END
WHERE concat_ws(' ', first_name, last_name) IN ('Pooja Sharma', 'Rashmi Joshi', 'Nandita Deshmukh', 'Pooja Chauhan');
