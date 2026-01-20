import { BrowserRouter, Routes, Route } from 'react-router-dom'
import './styles/responsive.css'
import Layout from './components/Layout'
import Home from './pages/Home'
import Base64 from './pages/Base64'
import Jwt from './pages/Jwt'
import Username from './pages/Username'
import Diff from './pages/Diff'
import Uuid from './pages/Uuid'
import Glass from './pages/Glass'
import Formatters from './pages/Formatters'
import Converter from './pages/Converter'
import Markdown from './pages/Markdown'
import Hash from './pages/Hash'
import Password from './pages/Password'
import ColorBlindness from './pages/ColorBlindness'
import BoxShadow from './pages/BoxShadow'
import UrlParser from './pages/UrlParser'
import MetaTags from './pages/MetaTags'
import FakerTool from './pages/Faker'
import Lorem from './pages/Lorem'
import CronParser from './pages/CronParser'
import SvgCompressor from './pages/SvgCompressor'
import Hmac from './pages/Hmac'
import Rsa from './pages/Rsa'
import Gradient from './pages/Gradient'
import Triangle from './pages/Triangle'
import UserAgent from './pages/UserAgent'
import Curl from './pages/Curl'
import Privacy from './pages/Privacy'
import Terms from './pages/Terms'

function App() {
  return (
    <BrowserRouter>
      <Layout>
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
          <Route path="/svg" element={<SvgCompressor />} />
          <Route path="/cron" element={<CronParser />} />
          <Route path="/markdown" element={<Markdown />} />
          <Route path="/privacy" element={<Privacy />} />
          <Route path="/terms" element={<Terms />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  )
}

export default App
