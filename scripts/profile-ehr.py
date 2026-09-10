"""Summarise collection sizes through AWS CLI; never persist source objects."""
import argparse
import json
import subprocess
from collections import Counter

parser = argparse.ArgumentParser()
parser.add_argument('--bucket', required=True)
parser.add_argument('--profile', default='default')
parser.add_argument('--sample-size', type=int, default=50)
args = parser.parse_args()
if not 20 <= args.sample_size <= 200:
    parser.error('sample-size must be between 20 and 200')

def aws(*command):
    result = subprocess.run(['aws', *command, '--profile', args.profile], capture_output=True)
    if result.returncode:
        raise SystemExit('AWS read failed; refresh credentials and check bucket permissions.')
    return result.stdout

listing = json.loads(aws('s3api', 'list-objects-v2', '--bucket', args.bucket,
                        '--max-keys', '1000', '--no-paginate', '--output', 'json'))
keys = [obj['Key'] for obj in listing.get('Contents', [])
        if obj['Key'].endswith('.json') and 0 < obj['Size'] <= 2_000_000][:args.sample_size]
collections = {key: Counter() for key in ['problems', 'medications', 'allergies', 'miscCodes']}
count = 0
for key in keys:
    record = json.loads(aws('s3', 'cp', 's3://' + args.bucket + '/' + key, '-', '--only-show-errors'))
    if not isinstance(record, dict) or not isinstance(record.get('demographics'), dict):
        continue
    count += 1
    for name, bins in collections.items():
        values = record.get(name, [])
        if not isinstance(values, list):
            continue
        size = len(values)
        bins['0' if size == 0 else '1-5' if size <= 5 else '6-20' if size <= 20 else '21+'] += 1
if count < 20:
    raise SystemExit('Fewer than 20 eligible records; no profile emitted.')
print(json.dumps({
    'id': 'ehr-collection-shape-v1',
    'source': 'production-ehr-collection-counts',
    'sampling': 'First eligible JSON objects in one bounded S3 listing; not population representative; objects may repeat patients.',
    'sampleCountRoundedDown': count // 5 * 5,
    'privacy': 'Only allowlisted collection counts; cells below five suppressed; other counts rounded down to multiples of five. No identifiers, dates, codes or text retained. This is not a differential privacy guarantee.',
    'collections': {name: {band: value // 5 * 5 for band, value in bins.items() if value >= 5}
                    for name, bins in collections.items()},
}, indent=2))
