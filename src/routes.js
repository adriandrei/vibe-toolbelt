import { lazy } from 'react';

export const Home = lazy(() => import('./pages/Home'));
export const AISettings = lazy(() => import('./pages/AISettings'));
export const Base64 = lazy(() => import('./pages/Base64'));
export const Jwt = lazy(() => import('./pages/Jwt'));
export const Username = lazy(() => import('./pages/Username'));
export const Diff = lazy(() => import('./pages/Diff'));
export const Uuid = lazy(() => import('./pages/Uuid'));
export const Glass = lazy(() => import('./pages/Glass'));
export const Formatters = lazy(() => import('./pages/Formatters'));
export const Converter = lazy(() => import('./pages/Converter'));
export const Markdown = lazy(() => import('./pages/Markdown'));
export const Hash = lazy(() => import('./pages/Hash'));
export const Password = lazy(() => import('./pages/Password'));
export const ColorBlindness = lazy(() => import('./pages/ColorBlindness'));
export const BoxShadow = lazy(() => import('./pages/BoxShadow'));
export const UrlParser = lazy(() => import('./pages/UrlParser'));
export const MetaTags = lazy(() => import('./pages/MetaTags'));
export const FakerTool = lazy(() => import('./pages/Faker'));
export const Lorem = lazy(() => import('./pages/Lorem'));
export const CronParser = lazy(() => import('./pages/CronParser'));
export const SvgCompressor = lazy(() => import('./pages/SvgCompressor'));
export const Hmac = lazy(() => import('./pages/Hmac'));
export const Rsa = lazy(() => import('./pages/Rsa'));
export const Gradient = lazy(() => import('./pages/Gradient'));
export const Triangle = lazy(() => import('./pages/Triangle'));
export const UserAgent = lazy(() => import('./pages/UserAgent'));
export const Curl = lazy(() => import('./pages/Curl'));
export const Privacy = lazy(() => import('./pages/Privacy'));
export const Terms = lazy(() => import('./pages/Terms'));
export const UnixTimestamp = lazy(() => import('./pages/UnixTimestamp'));
export const CidrCalculator = lazy(() => import('./pages/CidrCalculator'));
export const RegexTester = lazy(() => import('./pages/RegexTester'));
export const Inspector = lazy(() => import('./pages/Inspector'));
export const QrCode = lazy(() => import('./pages/QrCode'));
export const CaseConverter = lazy(() => import('./pages/CaseConverter'));
export const ImageConverter = lazy(() => import('./pages/ImageConverter'));
export const Snippets = lazy(() => import('./pages/Snippets'));
export const PdfTools = lazy(() => import('./pages/PdfTools'));
export const Recorder = lazy(() => import('./pages/Recorder'));
export const ExifViewer = lazy(() => import('./pages/ExifViewer'));
export const ApiTester = lazy(() => import('./pages/ApiTester'));
export const Base64Image = lazy(() => import('./pages/Base64Image'));
export const FaviconGenerator = lazy(() => import('./pages/FaviconGenerator'));
export const KeycodeViewer = lazy(() => import('./pages/KeycodeViewer'));
export const UrlEncode = lazy(() => import('./pages/UrlEncode'));
export const HtmlEntity = lazy(() => import('./pages/HtmlEntity'));
export const ColorConverter = lazy(() => import('./pages/ColorConverter'));
export const NumberBase = lazy(() => import('./pages/NumberBase'));
export const ListSorter = lazy(() => import('./pages/ListSorter'));
export const HttpStatus = lazy(() => import('./pages/HttpStatus'));
export const Chmod = lazy(() => import('./pages/Chmod'));
export const NanoId = lazy(() => import('./pages/NanoId'));
export const Bcrypt = lazy(() => import('./pages/Bcrypt'));
export const Aes = lazy(() => import('./pages/Aes'));
export const Otp = lazy(() => import('./pages/Otp'));
export const CsvJson = lazy(() => import('./pages/CsvJson'));
export const TextStats = lazy(() => import('./pages/TextStats'));
export const HexViewer = lazy(() => import('./pages/HexViewer'));
export const PrivacyScanner = lazy(() => import('./pages/PrivacyScanner'));
export const VideoTools = lazy(() => import('./pages/VideoTools'));
export const TypeConverter = lazy(() => import('./pages/TypeConverter'));
export const NotFound = lazy(() => import('./pages/NotFound'));

export const ROUTE_MAP = {
  '/': Home,
  '/ai-settings': AISettings,
  '/base64': Base64,
  '/jwt': Jwt,
  '/username': Username,
  '/diff': Diff,
  '/uuid': Uuid,
  '/hash': Hash,
  '/hmac': Hmac,
  '/rsa': Rsa,
  '/password': Password,
  '/url': UrlParser,
  '/ua': UserAgent,
  '/curl': Curl,
  '/meta': MetaTags,
  '/faker': FakerTool,
  '/lorem': Lorem,
  '/css': Glass,
  '/gradient': Gradient,
  '/triangle': Triangle,
  '/color-blindness': ColorBlindness,
  '/box-shadow': BoxShadow,
  '/formatters': Formatters,
  '/converter': Converter,
  '/unix': UnixTimestamp,
  '/cidr': CidrCalculator,
  '/svg': SvgCompressor,
  '/cron': CronParser,
  '/markdown': Markdown,
  '/privacy': Privacy,
  '/terms': Terms,
  '/regex': RegexTester,
  '/inspect': Inspector,
  '/qrcode': QrCode,
  '/case': CaseConverter,
  '/image': ImageConverter,
  '/snippets': Snippets,
  '/pdf': PdfTools,
  '/recorder': Recorder,
  '/exif': ExifViewer,
  '/api': ApiTester,
  '/image-base64': Base64Image,
  '/favicon': FaviconGenerator,
  '/keycode': KeycodeViewer,
  '/urlencode': UrlEncode,
  '/html-entity': HtmlEntity,
  '/color': ColorConverter,
  '/number-base': NumberBase,
  '/list': ListSorter,
  '/http-status': HttpStatus,
  '/chmod': Chmod,
  '/nanoid': NanoId,
  '/bcrypt': Bcrypt,
  '/aes': Aes,
  '/otp': Otp,
  '/csv-json': CsvJson,
  '/text-stats': TextStats,
  '/hex': HexViewer,
  '/privacy-scanner': PrivacyScanner,
  '/video': VideoTools,
  '/type-converter': TypeConverter,
};
