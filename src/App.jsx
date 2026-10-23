import { createBrowserRouter, Navigate, RouterProvider, useLocation } from 'react-router-dom'
import { HelmetProvider } from 'react-helmet-async'
import Layout from './components/Layout'
import RouteError from './components/RouteError'
import { ToastProvider } from './components/ToastProvider'
import { ThemeProvider } from './components/ThemeProvider'
import { PipelineProvider } from './contexts/PipelineContext'
import { AIProvider } from './contexts/AIContext'
import AILoadingModal from './components/AILoadingModal'
import { ROUTE_MAP, NotFound } from './routes'

// Each page is wrapped in an error boundary by Layout (reset on navigation);
// errorElement catches anything that escapes the layout itself.
const router = createBrowserRouter([
    {
        element: <Layout />,
        errorElement: <RouteError />,
        children: [
            ...Object.entries(ROUTE_MAP).map(([path, Component]) => ({
                path,
                element: <Component />,
            })),
            // Old or alternative paths (keep any smart-input state)
            { path: '/settings', element: <Redirect to="/ai-settings" /> },
            { path: '/api', element: <Redirect to="/api-tester" /> },
            { path: '*', element: <NotFound /> },
        ],
    },
])

function Redirect({ to }) {
    const location = useLocation()
    return <Navigate to={`${to}${location.search}${location.hash}`} replace state={location.state} />
}

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
