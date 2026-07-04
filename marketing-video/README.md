# KRW Ontology Marketing Video

Remotion-based ad template for KRW Ontology.

## Compositions

- `KrwOntologyAdWide`: 1920x1080, 18s, 30fps
- `KrwOntologyAdVertical`: 1080x1920, 18s, 30fps

## Preview

```bash
npm run dev
```

## Render

```bash
npx remotion render KrwOntologyAdWide out/krw-ontology-ad-wide.mp4 --codec=h264 --crf=20
npx remotion render KrwOntologyAdVertical out/krw-ontology-ad-vertical.mp4 --codec=h264 --crf=20
```

## Assets

Product screenshots live in `public/screenshots/`.

They were captured from the local Next.js app and are embedded with Remotion's
`Img` and `staticFile()` APIs so renders wait for image loading.

## Message

The current ad angle is:

> 질문을 먼저 정리하고, 공시 맥락과 확인 포인트를 답변으로 묶습니다.

The video avoids exposing internal labels. It presents the product as a
filing-aware research structure for Korean investors researching U.S. public
companies.
