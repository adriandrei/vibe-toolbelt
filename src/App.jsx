import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { Suspense, lazy } from 'react'
import './styles/responsive.css'
import Layout from './components/Layout'

// Lazy-loaded page components for code splitting
const Home = lazy(() => import('./pages/Home'))
const Base64 = lazy(() => import('./pages/Base64'))
const Jwt = lazy(() => import('./pages/Jwt'))
const Username = lazy(() => import('./pages/Username'))
const Diff = lazy(() => import('./pages/Diff'))
const Uuid = lazy(() => import('./pages/Uuid'))
const Glass = lazy(() => import('./pages/Glass'))
const Formatters = lazy(() => import('./pages/Formatters'))
const Converter = lazy(() => import('./pages/Converter'))
const Markdown = lazy(() => import('./pages/Markdown'))
const Hash = lazy(() => import('./pages/Hash'))
const Password = lazy(() => import('./pages/Password'))
const ColorBlindness = lazy(() => import('./pages/ColorBlindness'))
const BoxShadow = lazy(() => import('./pages/BoxShadow'))
const UrlParser = lazy(() => import('./pages/UrlParser'))
const MetaTags = lazy(() => import('./pages/MetaTags'))
const FakerTool = lazy(() => import('./pages/Faker'))
const Lorem = lazy(() => import('./pages/Lorem'))
const CronParser = lazy(() => import('./pages/CronParser'))
const SvgCompressor = lazy(() => import('./pages/SvgCompressor'))
const Hmac = lazy(() => import('./pages/Hmac'))
const Rsa = lazy(() => import('./pages/Rsa'))
const Gradient = lazy(() => import('./pages/Gradient'))
const Triangle = lazy(() => import('./pages/Triangle'))
const UserAgent = lazy(() => import('./pages/UserAgent'))
const Curl = lazy(() => import('./pages/Curl'))
const Privacy = lazy(() => import('./pages/Privacy'))
const Terms = lazy(() => import('./pages/Terms'))
const UnixTimestamp = lazy(() => import('./pages/UnixTimestamp'))
const CidrCalculator = lazy(() => import('./pages/CidrCalculator'))
const RegexTester = lazy(() => import('./pages/RegexTester'))
const Inspector = lazy(() => import('./pages/Inspector'))
const QrCode = lazy(() => import('./pages/QrCode'))
const CaseConverter = lazy(() => import('./pages/CaseConverter'))
const ImageConverter = lazy(() => import('./pages/ImageConverter'))
const Snippets = lazy(() => import('./pages/Snippets'))
const PdfTools = lazy(() => import('./pages/PdfTools'))
const Recorder = lazy(() => import('./pages/Recorder'))
const ExifViewer = lazy(() => import('./pages/ExifViewer'))

// Simple loading fallback
const PageLoader = () => (
  <div style={{
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '50vh',
    color: 'var(--text-muted)'
  }}>
    Loading...
  </div>
)

function App() {
  return (
    <BrowserRouter>
      <Layout>
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/base64" element={<Base64 />} />
            <Route path="/jwt" element={<Jwt />} />
            <Route path="/username" element={<Username />} />
            <Route path="/diff" element={<Diff />} />
            <Route path="/uuid" element={<Uuid />} />
            <Route path="/hash" element={<Hash />} />
            <Route path="/hmac" element={<Hmac />} />
            <Route path="/rsa" element={<Rsa />} />
            <Route path="/password" element={<Password />} />
            <Route path="/url" element={<UrlParser />} />
            <Route path="/ua" element={<UserAgent />} />
            <Route path="/curl" element={<Curl />} />
            <Route path="/meta" element={<MetaTags />} />
            <Route path="/faker" element={<FakerTool />} />
            <Route path="/lorem" element={<Lorem />} />
            <Route path="/css" element={<Glass />} />
            <Route path="/gradient" element={<Gradient />} />
            <Route path="/triangle" element={<Triangle />} />
            <Route path="/color-blindness" element={<ColorBlindness />} />
            <Route path="/box-shadow" element={<BoxShadow />} />
            <Route path="/formatters" element={<Formatters />} />
            <Route path="/converter" element={<Converter />} />
            <Route path="/unix" element={<UnixTimestamp />} />
            <Route path="/cidr" element={<CidrCalculator />} />
            <Route path="/svg" element={<SvgCompressor />} />
            <Route path="/cron" element={<CronParser />} />
            <Route path="/markdown" element={<Markdown />} />
            <Route path="/privacy" element={<Privacy />} />
            <Route path="/terms" element={<Terms />} />
            <Route path="/regex" element={<RegexTester />} />
            <Route path="/inspect" element={<Inspector />} />
            <Route path="/qrcode" element={<QrCode />} />
            <Route path="/case" element={<CaseConverter />} />
            <Route path="/image" element={<ImageConverter />} />
            <Route path="/snippets" element={<Snippets />} />
            <Route path="/pdf" element={<PdfTools />} />
            <Route path="/recorder" element={<Recorder />} />
            <Route path="/exif" element={<ExifViewer />} />
          </Routes>
        </Suspense>
      </Layout>
    </BrowserRouter>
  )
}

export default App
