import { component, signal, computed } from 'sigx';

const Counter = component(() => {
    const count = signal({ value: 0 });
    const doubled = computed(() => count.value * 2);

    return () => (
        <div class="row">
            <button onClick={() => { count.value -= 1; }}>−</button>
            <span>count = {count.value} (×2 = {doubled.value})</span>
            <button onClick={() => { count.value += 1; }}>+</button>
        </div>
    );
});

const Greeting = component<{ name: string }>(ctx => {
    return () => <p>Hello, <strong>{ctx.props.name}</strong>.</p>;
});

export const App = component(() => {
    const who = signal({ name: 'world' });

    return () => (
        <main>
            <h1>SigX DevTools example</h1>
            <p>Open the SignalX panel in browser devtools to inspect this app.</p>
            <Greeting name={who.name} />
            <Counter />
            <div class="row">
                <button onClick={() => { who.name = who.name === 'world' ? 'devtools' : 'world'; }}>
                    toggle greeting
                </button>
            </div>
        </main>
    );
});
