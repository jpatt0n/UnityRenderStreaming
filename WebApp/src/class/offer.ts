import { ResolvedAuthProfile } from "./authstore";

export default class Offer {
  sdp: string;
  datetime: number;
  polite: boolean;
  authProfile?: ResolvedAuthProfile;
  constructor(sdp: string, datetime: number, polite: boolean, authProfile?: ResolvedAuthProfile) {
    this.sdp = sdp;
    this.datetime = datetime;
    this.polite = polite;
    this.authProfile = authProfile;
  }
}
