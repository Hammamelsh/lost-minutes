"use client";

import {Component,type ReactNode} from 'react';

/**
 * A view behind the data that fails (a published file it cannot read, say) must never take the
 * passenger's page down with it. Without this, one malformed file replaced the whole page, the
 * passenger's live view included, with the framework's "This page couldn't load". It says so in
 * place, offers the way back, and tries again when another view is chosen.
 */
export default class SectionBoundary extends Component<{children:ReactNode;onBack:()=>void;resetKey:string},{failed:string|null}>{
 state={failed:null as string|null};
 static getDerivedStateFromError(error:unknown){return {failed:error instanceof Error?error.message:'an unknown error'}}
 componentDidUpdate(previous:{resetKey:string}){
  if(previous.resetKey!==this.props.resetKey&&this.state.failed)this.setState({failed:null});
 }
 render(){
  if(!this.state.failed)return this.props.children;
  return <section className="ops-card ops-empty" role="alert">
   <h3>This view could not be shown</h3>
   <p>Part of what it reads could not be used ({this.state.failed}). Your stop and your bus are unaffected.</p>
   <button className="action" onClick={this.props.onBack}>Back to buses</button>
  </section>;
 }
}
