/* Адрес S3: в virtual-hosted стиле бакет должен оказаться в хосте, иначе Bun.S3Client пишет мимо бакета (Yandex, AWS) */
import { describe, expect, test } from 'bun:test';
import { s3Endpoint } from '../src/file-store';

const url = (endpoint: string, forcePathStyle: boolean) => {
  const c = new Bun.S3Client({ endpoint: s3Endpoint({ endpoint, bucket: 'docs', forcePathStyle }), region: 'ru-central1', bucket: 'docs', accessKeyId: 'a', secretAccessKey: 'b', virtualHostedStyle: !forcePathStyle });
  return c.presign('x/y.pdf').split('?')[0];
};

describe('s3Endpoint', () => {
  test('virtual-hosted: бакет в хосте (Yandex Object Storage)', () => {
    expect(url('https://storage.yandexcloud.net', false)).toBe('https://docs.storage.yandexcloud.net/x/y.pdf');
  });
  test('бакет уже в хосте — не дублируется', () => {
    expect(url('https://docs.storage.yandexcloud.net', false)).toBe('https://docs.storage.yandexcloud.net/x/y.pdf');
  });
  test('path style (MinIO): endpoint/bucket/key', () => {
    expect(url('http://minio:9000', true)).toBe('http://minio:9000/docs/x/y.pdf');
  });
});
