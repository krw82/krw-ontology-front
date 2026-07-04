-- Add well-known investor 13F filers to the institutional holdings page.

insert into public.institutional_managers (
  cik,
  name,
  display_name,
  country_code,
  notes
) values
  (
    '0001536411',
    'Duquesne Family Office LLC',
    '드러켄밀러 / Duquesne Family Office',
    'US',
    'Stanley Druckenmiller''s Duquesne Family Office 13F filer on SEC EDGAR.'
  ),
  (
    '0000850529',
    'Fisher Asset Management, LLC',
    '켄 피셔 / Fisher Asset Management',
    'US',
    'Ken Fisher''s Fisher Asset Management 13F filer on SEC EDGAR.'
  ),
  (
    '0001336528',
    'Pershing Square Capital Management, L.P.',
    '빌 애크먼 / Pershing Square',
    'US',
    'Bill Ackman''s Pershing Square Capital Management 13F filer on SEC EDGAR.'
  ),
  (
    '0001656456',
    'Appaloosa LP',
    '데이비드 테퍼 / Appaloosa',
    'US',
    'David Tepper''s Appaloosa 13F filer on SEC EDGAR.'
  ),
  (
    '0001061768',
    'Baupost Group LLC/MA',
    '세스 클라먼 / Baupost Group',
    'US',
    'Seth Klarman''s Baupost Group 13F filer on SEC EDGAR.'
  ),
  (
    '0001040273',
    'Third Point LLC',
    '댄 로브 / Third Point',
    'US',
    'Dan Loeb''s Third Point 13F filer on SEC EDGAR.'
  ),
  (
    '0001029160',
    'Soros Fund Management LLC',
    '조지 소로스 / Soros Fund Management',
    'US',
    'George Soros''s Soros Fund Management 13F filer on SEC EDGAR.'
  ),
  (
    '0001135730',
    'Coatue Management LLC',
    '필립 라퐁 / Coatue',
    'US',
    'Philippe Laffont''s Coatue Management 13F filer on SEC EDGAR.'
  ),
  (
    '0001167483',
    'Tiger Global Management LLC',
    '체이스 콜먼 / Tiger Global',
    'US',
    'Chase Coleman''s Tiger Global Management 13F filer on SEC EDGAR.'
  ),
  (
    '0001103804',
    'Viking Global Investors LP',
    '안드레아스 할보르센 / Viking Global',
    'US',
    'Andreas Halvorsen''s Viking Global Investors 13F filer on SEC EDGAR.'
  ),
  (
    '0001061165',
    'Lone Pine Capital LLC',
    '스티브 맨델 / Lone Pine Capital',
    'US',
    'Steve Mandel''s Lone Pine Capital 13F filer on SEC EDGAR.'
  )
on conflict (cik) do update set
  name = excluded.name,
  display_name = excluded.display_name,
  country_code = excluded.country_code,
  notes = excluded.notes,
  updated_at = now();
