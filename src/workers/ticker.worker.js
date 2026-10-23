// Posts a message `fps` times per second. Used to drive canvas drawing on the
// page: worker timers keep running while the tab is in the background, where
// requestAnimationFrame stops and window timers are throttled.

let timer = 0

self.onmessage = ({ data }) => {
    clearInterval(timer)
    if (data?.fps > 0) timer = setInterval(() => self.postMessage(0), 1000 / data.fps)
}
