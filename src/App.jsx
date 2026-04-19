import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { Suspense, lazy } from 'react'
import { HelmetProvider } from 'react-helmet-async'
import './styles/responsive.css'
import Layout from './components/Layout'
import ErrorBoundary from './components/ErrorBoundary'
import { ToastProvider } from './components/ToastProvider'
import { ThemeProvider } from './components/ThemeProvider'

import { PipelineProvider } from './contexts/PipelineContext'
import { ROUTE_MAP, NotFound } from './routes'

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
    <ThemeProvider>
      <ToastProvider>
        <HelmetProvider>
          <PipelineProvider>
            <BrowserRouter>
              <Layout>
                <ErrorBoundary>
                  <Suspense fallback={<PageLoader />}>
                    <Routes>
                      {Object.entries(ROUTE_MAP).map(([path, Component]) => (
                        <Route key={path} path={path} element={<Component />} />
                      ))}
                      <Route path="*" element={<NotFound />} />
                    </Routes>
                  </Suspense>
                </ErrorBoundary>
              </Layout>
            </BrowserRouter>
          </PipelineProvider>
        </HelmetProvider>
      </ToastProvider>
    </ThemeProvider>
  )
}

export default App
