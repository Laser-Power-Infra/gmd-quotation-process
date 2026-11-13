import { ValveSerialPage } from "@gmd/valve-serial/ui";
import * as actions from "./actions";

export default function Page() {
  return <ValveSerialPage actions={{ ...actions }} />;
}
