// Trusted JS worker backend adapter; JS is NOT an untrusted sandbox.
export async function create_tenant({tenant,generation}) {
  let count=0;
  return {on_message:async()=>({value:String(++count),tenant,generation})};
}
