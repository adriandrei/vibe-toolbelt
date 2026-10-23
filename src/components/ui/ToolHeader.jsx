import PageHeader from './PageHeader'
import { getTool } from '../../config/tools'
import { usePane } from '../../contexts/pane'
import { useDocumentTitle } from '../../hooks/useDocumentTitle'

/**
 * Page header for a tool, taken from the tool registry (src/config/tools.js):
 * icon, title and description. Also sets the tab title (main pane only).
 *
 *   <ToolHeader />                       // uses the current pane's route
 *   <ToolHeader subtitle="Custom text" actions={<button/>} />
 */
export default function ToolHeader({ path, title, subtitle, icon, ...rest }) {
    const pane = usePane()
    const tool = getTool(path ?? pane.path)
    const resolvedTitle = title ?? tool?.title ?? ''
    useDocumentTitle(resolvedTitle)
    return (
        <PageHeader
            icon={icon ?? tool?.icon}
            title={resolvedTitle}
            subtitle={subtitle ?? tool?.description}
            {...rest}
        />
    )
}
