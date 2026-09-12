/* Shared schema builder used by setup.html and dashboard.html (Schema Manager).
 * Renders a draggable list of field cards. Each card has label, type, required,
 * and (for numbers) computed. The "list" type exposes a nested sub-field editor.
 */
window.SchemaBuilder = (function () {
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function slugify(label) {
    if (!label) return '';
    return String(label)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '');
  }

  function fieldTypes(includeList) {
    const types = [
      ['text', 'Text'], ['number', 'Number'], ['email', 'Email'],
      ['date', 'Date'], ['boolean', 'Boolean']
    ];
    if (includeList) types.push(['list', 'List']);
    return types;
  }

  function init({ container, schema = [], includeList = true }) {
    let current = (schema || []).map((f, i) => ({
      id: Date.now() + i, name: '', label: '', type: 'text',
      required: false, computed: false, subfields: [], ...f
    }));

    container.innerHTML = `
      <div class="schema-builder">
        <div class="builder-header">
          <span>Fields Configuration</span>
          <span class="sb-count">0 fields</span>
        </div>
        <div class="builder-list"></div>
        <div class="builder-footer">
          <button type="button" class="btn-add-field">+ Add Field</button>
        </div>
      </div>`;

    const root = container.querySelector('.schema-builder');
    const listEl = root.querySelector('.builder-list');
    const countEl = root.querySelector('.sb-count');
    const addBtn = root.querySelector('.btn-add-field');

    function render() {
      countEl.textContent = `${current.length} field${current.length === 1 ? '' : 's'}`;
      listEl.innerHTML = '';

      current.forEach((field, index) => {
        const card = document.createElement('div');
        card.className = 'field-card' + (field.type === 'list' ? ' field-card-list' : '');
        card.draggable = true;
        card.dataset.id = field.id;

        card.innerHTML = `
          <div class="drag-handle">⠿</div>
          <div class="form-group" style="margin:0">
            <input type="text" class="field-input" placeholder="Label" value="${esc(field.label)}">
          </div>
          <div class="form-group" style="margin:0">
            <select class="field-input">
              ${fieldTypes(includeList).map(([v, l]) => `<option value="${v}" ${field.type === v ? 'selected' : ''}>${l}</option>`).join('')}
            </select>
          </div>
          <div class="field-checkbox-group">
            <input type="checkbox" class="flag-required" ${field.required ? 'checked' : ''}>
            <label>Required</label>
          </div>
          <div class="field-checkbox-group ${field.type === 'number' ? '' : 'hidden'}">
            <input type="checkbox" class="flag-computed" ${field.computed ? 'checked' : ''}>
            <label>Computed</label>
          </div>
          <button class="btn-remove-field" title="Remove Field">×</button>
          ${field.type === 'list' ? '<div class="sb-subeditor"></div>' : ''}
        `;

        // Top-level controls
        card.querySelector('.field-input').onchange = (e) => {
          field.label = e.target.value;
          field.name = slugify(field.label);
        };
        card.querySelector('select.field-input').onchange = (e) => {
          const nextType = e.target.value;
          if (nextType !== field.type) {
            if (nextType !== 'number') field.computed = false;
            if (nextType !== 'list') field.subfields = [];
            field.type = nextType;
            render();
          }
        };
        card.querySelector('.flag-required').onchange = (e) => {
          field.required = e.target.checked;
        };
        const computedEl = card.querySelector('.flag-computed');
        if (computedEl) computedEl.onchange = (e) => { field.computed = e.target.checked; };
        card.querySelector('.btn-remove-field').onclick = () => {
          current = current.filter(f => f.id !== field.id);
          render();
        };

        const sub = card.querySelector('.sb-subeditor');
        if (sub) renderSubeditor(sub, field);

        card.addEventListener('dragstart', (e) => {
          e.target.classList.add('dragging');
          e.dataTransfer.setData('text/plain', index);
        });
        card.addEventListener('dragend', (e) => {
          e.target.classList.remove('dragging');
        });

        listEl.appendChild(card);
      });

      listEl.ondragover = (e) => {
        e.preventDefault();
        const dragging = listEl.querySelector('.dragging');
        if (!dragging) return;
        const after = getDragAfterElement(listEl, e.clientY);
        if (after == null) listEl.appendChild(dragging);
        else listEl.insertBefore(dragging, after);
      };
      listEl.ondrop = (e) => {
        e.preventDefault();
        const order = Array.from(listEl.children).map(el => current.find(f => f.id == el.dataset.id));
        if (order.every(Boolean)) {
          current = order;
          render();
        }
      };
    }

    function renderSubeditor(container, field) {
      field.subfields = field.subfields || [];
      container.innerHTML = `
        <div class="sb-subeditor-header">
          <strong>Sub-fields</strong>
          <button type="button" class="btn-add-field">+ Add Sub-field</button>
        </div>
        <div class="sb-subfields"></div>`;

      const wrap = container.querySelector('.sb-subfields');
      container.querySelector('.btn-add-field').onclick = () => {
        field.subfields.push({ id: Date.now(), name: '', label: '', type: 'text', required: false });
        renderSubeditor(container, field);
      };

      field.subfields.forEach((sf) => {
        const row = document.createElement('div');
        row.className = 'sb-subfield-row';
        row.innerHTML = `
          <div class="form-group" style="margin:0">
            <input type="text" class="field-input" placeholder="Label" value="${esc(sf.label)}">
          </div>
          <div class="form-group" style="margin:0">
            <select class="field-input">
              ${fieldTypes(false).map(([v, l]) => `<option value="${v}" ${sf.type === v ? 'selected' : ''}>${l}</option>`).join('')}
            </select>
          </div>
          <div class="field-checkbox-group">
            <input type="checkbox" class="flag-required" ${sf.required ? 'checked' : ''}>
            <label>Req</label>
          </div>
          <button class="btn-remove-field" title="Remove">×</button>`;

        row.querySelector('.field-input').onchange = (e) => {
          sf.label = e.target.value;
          sf.name = slugify(sf.label);
        };
        row.querySelector('select.field-input').onchange = (e) => { sf.type = e.target.value; };
        row.querySelector('.flag-required').onchange = (e) => { sf.required = e.target.checked; };
        row.querySelector('.btn-remove-field').onclick = () => {
          field.subfields = field.subfields.filter(s => s.id !== sf.id);
          renderSubeditor(container, field);
        };

        wrap.appendChild(row);
      });
    }

    function getDragAfterElement(container, y) {
      const els = [...container.querySelectorAll('.field-card:not(.dragging)')];
      return els.reduce((closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;
        if (offset < 0 && offset > closest.offset) return { offset, element: child };
        return closest;
      }, { offset: Number.NEGATIVE_INFINITY }).element;
    }

    addBtn.onclick = () => {
      current.push({ id: Date.now(), name: '', label: '', type: 'text', required: false, computed: false, subfields: [] });
      render();
    };

    render();

    return {
      getFields: () => current.map(({ id, subfields, ...rest }) => ({
        ...rest,
        subfields: (subfields || []).map(({ id: sid, ...sf }) => ({ ...sf }))
      })),
      setFields: (schema) => {
        current = (schema || []).map((f, i) => ({
          id: Date.now() + i, name: '', label: '', type: 'text',
          required: false, computed: false, subfields: [], ...f
        }));
        render();
      }
    };
  }

  return { init };
})();