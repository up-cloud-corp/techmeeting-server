import tracer from "dd-trace";
const config = require('../config');
if (config.datadog.enabled) {
  tracer.init(); // initialized in a different file to avoid hoisting.
}
export default tracer;