import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

/**
 * useSmartInput
 * Automatically pre-fills component state from React Router location state.
 * 
 * @param {Object} stateSetters - An object mapping state keys to their respective React setState functions.
 *                 Example: { input: setInput, mode: setMode }
 *                 It will look for `location.state.input` and `location.state.mode`.
 */
export function useSmartInput(stateSetters) {
    const location = useLocation();
    const navigate = useNavigate();

    useEffect(() => {
        if (location.state) {
            let hasInjected = false;

            // Loop through the provided state setters
            Object.keys(stateSetters).forEach(key => {
                if (location.state[key] !== undefined && location.state[key] !== null) {
                    // Update the state using the provided setter
                    stateSetters[key](location.state[key]);
                    hasInjected = true;
                }
            });

            // Once we have consumed the smart input state, we replace the history state
            // to clear it out, so refreshing the page doesn't keep replacing the user's new input with the old one
            if (hasInjected) {
                // Keep other state params, but remove the ones we just injected
                const nextState = { ...location.state };
                Object.keys(stateSetters).forEach(key => {
                    delete nextState[key];
                });

                // Replace the history so state is cleared
                navigate(location.pathname, {
                    replace: true,
                    state: Object.keys(nextState).length > 0 ? nextState : undefined
                });
            }
        }
    }, [location.state, location.pathname, navigate, stateSetters]);
}
