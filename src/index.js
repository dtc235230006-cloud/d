import { Container, getContainer } from "@cloudflare/containers";

export class FlaskAppContainer extends Container {
  defaultPort = 8080;
  sleepAfter = "5m";
  pingEndpoint = "localhost/healthz";
}

export default {
  fetch(request, env) {
    return getContainer(env.WEB_APP, "education-spatial-analytics").fetch(request);
  },
};
