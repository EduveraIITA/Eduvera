#!/usr/bin/env python3
"""Generate local secrets/configuration without contacting any cloud provider.

Only use synthetic data until the release gates in README.md have passed.
Generated configuration is JSON (valid YAML) to avoid a YAML dependency.
"""
import argparse
import json
import os
import re
import secrets
from pathlib import Path


def write_private(path: Path, content: str) -> None:
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w', encoding='utf-8') as stream:
        stream.write(content)


def generate(server_name: str, directory: Path) -> None:
    if not re.fullmatch(r'[a-z0-9]+(?:[.-][a-z0-9]+)*', server_name) or '.' not in server_name:
        raise ValueError('Use a lowercase DNS name, without scheme, port or path.')
    directory.mkdir(parents=True, exist_ok=True)
    runtime = directory / 'runtime'
    env_path = directory / '.env'
    if runtime.exists() or env_path.exists():
        raise FileExistsError('Refusing to overwrite existing runtime data or secrets.')
    runtime.mkdir(mode=0o700)
    synapse_dir = runtime / 'synapse'
    synapse_dir.mkdir(mode=0o700)
    as_token, hs_token, db_password = (secrets.token_hex(32) for _ in range(3))
    livekit_key, livekit_secret = secrets.token_hex(16), secrets.token_hex(32)
    config = {
        'server_name': server_name, 'public_baseurl': f'https://{server_name}/',
        'report_stats': False, 'pid_file': '/data/homeserver.pid',
        'listeners': [{'port': 8008, 'tls': False, 'type': 'http', 'bind_addresses': ['0.0.0.0'],
                       'resources': [{'names': ['client'], 'compress': False}]}],
        'database': {'name': 'psycopg2', 'args': {'user': 'synapse', 'password': db_password,
                     'database': 'synapse', 'host': 'postgres', 'port': 5432, 'cp_min': 2, 'cp_max': 5}},
        'media_store_path': '/data/media', 'signing_key_path': '/data/server.signing.key',
        'macaroon_secret_key': secrets.token_hex(32), 'form_secret': secrets.token_hex(32),
        'enable_registration': False, 'allow_guest_access': False,
        'password_config': {'enabled': False}, 'user_directory': {'enabled': False},
        'allow_public_rooms_without_auth': False, 'allow_public_rooms_over_federation': False,
        'federation_domain_whitelist': [], 'trusted_key_servers': [],
        'suppress_key_server_warning': True, 'url_preview_enabled': False,
        'enable_metrics': False, 'max_upload_size': '10M',
        'app_service_config_files': ['/data/eduvera-appservice.yaml'],
    }
    registration = {
        'id': 'eduvera-governed-chat', 'url': None, 'as_token': as_token, 'hs_token': hs_token,
        'sender_localpart': 'eduvera_bot', 'rate_limited': True,
        'namespaces': {
            'users': [{'exclusive': True, 'regex': '^@edu_[0-9a-f]{32}_[0-9a-f]{32}:' + re.escape(server_name) + '$'}],
            'aliases': [{'exclusive': True, 'regex': '^#edu_room_[0-9a-f]{32}_[0-9a-f]{32}:' + re.escape(server_name) + '$'}],
            'rooms': [],
        },
    }
    for path, data in [(synapse_dir / 'homeserver.yaml', config),
                       (synapse_dir / 'eduvera-appservice.yaml', registration)]:
        write_private(path, json.dumps(data, indent=2) + '\n')
    write_private(env_path, f'MATRIX_UID={os.getuid()}\nMATRIX_GID={os.getgid()}\nSYNAPSE_DB_PASSWORD={db_password}\n')
    # API must receive these separately via Secret Manager. Never put them in VITE_*.
    bridge = f'MATRIX_ENABLED=true\nMATRIX_INTERNAL_URL=http://synapse:8008\nMATRIX_SERVER_NAME={server_name}\nMATRIX_AS_TOKEN={as_token}\n'
    write_private(runtime / 'bridge.env', bridge)
    write_private(runtime / 'worker.env', bridge + f'COOKIE_SECRET={secrets.token_hex(32)}\nDATABASE_URL=\nDATABASE_POOL_MAX=3\n')
    write_private(runtime / 'livekit.yaml', json.dumps({
        'port': 7880, 'rtc': {'tcp_port': 7881, 'port_range_start': 50000, 'port_range_end': 50100,
                            'use_external_ip': False},
        'keys': {livekit_key: livekit_secret}, 'room': {'auto_create': False},
        'webhook': {'api_key': livekit_key, 'urls': ['http://matrix-rtc:8080/sfu_webhook']},
    }, indent=2) + '\n')
    write_private(runtime / 'rtc.env', f'LIVEKIT_URL=ws://livekit:7880\nLIVEKIT_KEY={livekit_key}\nLIVEKIT_SECRET={livekit_secret}\nLIVEKIT_FULL_ACCESS_HOMESERVERS={server_name}\nLIVEKIT_LOG_LEVEL=warn\n')
    # No analytics credentials, public registration or guest login are configured.
    write_private(runtime / 'element-call.json', json.dumps({
        'default_server_config': {'m.homeserver': {'base_url': f'https://{server_name}', 'server_name': server_name}},
    }, indent=2) + '\n')
    # This file is served to browsers and contains no secrets. Nginx must be able to read it.
    (runtime / 'element-call.json').chmod(0o644)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--server-name', required=True)
    parser.add_argument('--directory', type=Path, default=Path(__file__).resolve().parent)
    args = parser.parse_args()
    try:
        generate(args.server_name, args.directory)
    except (ValueError, FileExistsError) as error:
        parser.error(str(error))
    print('Private configuration created. No servers were provisioned or started. See README.md before use.')
