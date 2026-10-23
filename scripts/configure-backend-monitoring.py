#!/usr/bin/env python3
"""Preview, or --apply, MRT's non-mutating backend availability checks."""
import argparse
import base64
import json
import subprocess
import urllib.request

PROJECT = 'marketready-tours'
ENDPOINTS = ('saveTour', 'submitIntake', 'submitRating')
CHANNEL = f'projects/{PROJECT}/notificationChannels/15708137871918851283'
POLICY_NAME = 'MarketReady Tours: critical backend unavailable'

def check_config(endpoint):
    return {
        'displayName': f'MRT backend: {endpoint}',
        'monitoredResource': {'type': 'uptime_url', 'labels': {
            'project_id': PROJECT, 'host': f'us-central1-{PROJECT}.cloudfunctions.net'}},
        'httpCheck': {'useSsl': True, 'validateSsl': True, 'port': 443,
            'path': '/' + endpoint, 'requestMethod': 'POST',
            'contentType': 'USER_PROVIDED', 'customContentType': 'application/json',
            'body': base64.b64encode(b'{"data":{}}').decode(),
            'acceptedResponseStatusCodes': [{'statusValue': 401}]},
        'contentMatchers': [{'content': 'UNAUTHENTICATED', 'matcher': 'CONTAINS_STRING'}],
        'period': '60s', 'timeout': '10s',
        'selectedRegions': ['USA_OREGON', 'USA_VIRGINIA', 'EUROPE']}

def policy_config(checks):
    conditions = []
    for check in checks:
        check_id = check['name'].rsplit('/', 1)[-1]
        conditions.append({'displayName': check['displayName'] + ' failing',
            'conditionThreshold': {
                'filter': 'metric.type="monitoring.googleapis.com/uptime_check/check_passed" '
                    'AND resource.type="uptime_url" AND metric.label.check_id="' + check_id + '"',
                'comparison': 'COMPARISON_GT', 'thresholdValue': 1,
                'duration': '120s', 'trigger': {'count': 1},
                'aggregations': [{'alignmentPeriod': '60s', 'perSeriesAligner': 'ALIGN_NEXT_OLDER',
                    'crossSeriesReducer': 'REDUCE_COUNT_FALSE', 'groupByFields': ['resource.label.host']}]}})
    return {'displayName': POLICY_NAME, 'enabled': True, 'combiner': 'OR',
        'notificationChannels': [CHANNEL], 'conditions': conditions,
        'alertStrategy': {'autoClose': '1800s'},
        'documentation': {'mimeType': 'text/markdown', 'content':
            'A critical MRT backend failed its 60-second startup/authentication probe from at least '
            'two checker locations for two minutes. Check the named function and Cloud Run startup '
            'logs immediately, even if the homepage is healthy.\n\n'
            'Healthy probes deliberately receive HTTP 401 with UNAUTHENTICATED. They carry no '
            'credentials or real data and never save a tour, submit feedback or send email. '
            'This checks endpoint availability, not authenticated database persistence or CORS.\n\n'
            'See docs/BACKEND-RECOVERY.md. Preserve Auth/App Check, capture logs before redeploying, '
            'deploy only named functions, verify a real authenticated save and database read-back. '
            'Do not perform blind regional failover or send test emails to agents.'}}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    configs = [check_config(endpoint) for endpoint in ENDPOINTS]
    if not args.apply:
        print(json.dumps(configs, indent=2)); return
    token = subprocess.check_output(['/opt/homebrew/share/google-cloud-sdk/bin/gcloud',
        'auth', 'print-access-token'], text=True).strip()
    def api(path, method='GET', body=None):
        req = urllib.request.Request('https://monitoring.googleapis.com/v3/' + path,
            data=json.dumps(body).encode() if body is not None else None,
            headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'}, method=method)
        with urllib.request.urlopen(req, timeout=30) as response: return json.load(response)
    channel = api(CHANNEL)
    assert channel.get('enabled') and channel.get('labels', {}).get('email_address') == 'erik@marketreadysystems.ai'
    base = f'projects/{PROJECT}/'
    existing = api(base + 'uptimeCheckConfigs').get('uptimeCheckConfigs', [])
    checks = []
    for config in configs:
        matches = [item for item in existing if item['displayName'] == config['displayName']]
        assert len(matches) <= 1, 'Duplicate checks require manual review'
        if matches:
            # Do not silently overwrite manually edited monitoring configuration.
            check = matches[0]
            for key in config:
                assert check.get(key) == config[key], f'Existing check differs: {key}'
        else:
            check = api(base + 'uptimeCheckConfigs', 'POST', config)
        checks.append(check)
        print(check['name'])
    config = policy_config(checks)
    policies = api(base + 'alertPolicies').get('alertPolicies', [])
    matches = [item for item in policies if item['displayName'] == POLICY_NAME]
    assert len(matches) <= 1, 'Duplicate policies require manual review'
    if matches:
        print('Existing policy retained:', matches[0]['name'])
    else:
        print(api(base + 'alertPolicies', 'POST', config)['name'])

if __name__ == '__main__':
    main()
