// "Coming soon" stand-in for pages another contributor is building.
function mount(root, ctx) {
  const name = (ctx.route && (ctx.route.title || ctx.route.path)) || "this page";
  root.innerHTML = `
    <div class="notice">
      <div class="notice-title">${String(name).replace(/[<>&"]/g, "")}</div>
      <p>coming soon.</p>
      <a href="#/test">back to the test</a>
    </div>`;
}

export default { mount };
