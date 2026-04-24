import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import { Suspense, lazy } from 'react'
import { HelmetProvider } from 'react-helmet-async'
import './styles/responsive.css'
import Layout from './components/Layout'
import ErrorBoundary from './components/ErrorBoundary'
import { ToastProvider } from './components/ToastProvider'
import { ThemeProvider } from './components/ThemeProvider'

import { PipelineProvider } from './contexts/PipelineContext'
import { AIProvider } from './contexts/AIContext'
import AILoadingModal from './components/AILoadingModal'
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

const router = createBrowserRouter([
  {
    element: (
      <Layout />
    ),
    children: [
      ...Object.entries(ROUTE_MAP).map(([path, Component]) => ({
        path,
        element: (
          <ErrorBoundary>
            <Component />
          </ErrorBoundary>
        ),
      })),
      {
        path: '*',
        element: <NotFound />,
      },
    ],
  },
])

function App() {
  return (
    <ThemeProvider>
      <ToastProvider>
        <HelmetProvider>
          <PipelineProvider>
            <AIProvider>
              <RouterProvider router={router} />
              <AILoadingModal />
            </AIProvider>
          </PipelineProvider>
        </HelmetProvider>
      </ToastProvider>
    </ThemeProvider>
  )
}

export default App
